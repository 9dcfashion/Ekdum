"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { runAction, unwrap, ActionError, type ActionResult } from "@/lib/actions";
import { loadContext, type AppContext } from "@/lib/auth/context";
import { normalisePrefix, validateGstin, validateSeriesPrefix } from "@/lib/gst";
import { ilikeTerm } from "@/lib/list";
import { processDueNotifications } from "@/lib/notifications/process";
import { postInvoice, type PostResult } from "@/lib/sales/post";
import { loadPosCatalog } from "@/lib/pos/load";
import type { CatalogProduct, PosCustomer } from "@/lib/pos/types";
import { emailOptional, emailRequired, gstinOptional, mobileRequired, requiredText, stateCodeOptional, uuid } from "@/lib/validation/common";
import { saleInputSchema } from "@/lib/validation/sales";

const CUSTOMER_COLUMNS = "id, name, phone, email, gstin, address_line1, address_line2, city, pincode, state_code, whatsapp_opt_in";

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  whatsapp_opt_in: boolean;
}

function toPosCustomer(row: CustomerRow): PosCustomer {
  const address = [row.address_line1, row.address_line2, row.city].filter(Boolean).join(", ");
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    gstin: row.gstin,
    address: address || null,
    pincode: row.pincode,
    state_code: row.state_code,
    whatsapp_opt_in: row.whatsapp_opt_in,
  };
}

/** Send queued receipts right after the response, without making the cashier wait. */
function sendReceiptsSoon() {
  after(async () => {
    try {
      await processDueNotifications();
    } catch (error) {
      console.error("[pos] receipt processing failed", error instanceof Error ? error.message : error);
    }
  });
}

/**
 * Post one bill from the POS. Validates the payload and hands it to postInvoice(),
 * which re-checks permissions, recomputes every amount and writes the invoice in
 * one transaction. Safe to retry: the same client_uuid never creates a second bill.
 */
export async function submitSaleAction(input: unknown): Promise<PostResult> {
  try {
    const ctx = await loadContext();
    if (!ctx) return { ok: false, code: "forbidden", message: "Your session has expired. Please sign in again." };
    if (!ctx.business || !ctx.role || !ctx.memberId || !ctx.business.onboarding_completed_at) {
      return { ok: false, code: "forbidden", message: "Finish setting up your business first." };
    }
    const parsed = saleInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Please check the bill" };
    }

    const result = await postInvoice(ctx as AppContext, parsed.data, "pos_online");
    if (result.ok && !result.duplicate && (parsed.data.notify.email || parsed.data.notify.whatsapp)) {
      sendReceiptsSoon();
    }
    return result;
  } catch (error) {
    console.error("[pos] submit failed", error instanceof Error ? error.message : error);
    return { ok: false, code: "server_error", message: "Could not save the bill. Please try again." };
  }
}

/** Customer lookup by phone, name or GSTIN for the POS (needs customers.view). */
export async function searchCustomersAction(query: string): Promise<ActionResult<PosCustomer[]>> {
  return runAction(z.string().trim().max(60), query, { perm: "customers.view" }, async (q, ctx) => {
    const term = ilikeTerm(q);
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, "");
    const filters = [`name.ilike.%${term}%`, `gstin.ilike.${term}%`];
    if (digits.length >= 3) filters.push(`phone.ilike.%${digits.slice(-10)}%`);
    const rows = unwrap(
      await ctx.supabase
        .from("customers")
        .select(CUSTOMER_COLUMNS)
        .eq("business_id", ctx.business.id)
        .or(filters.join(","))
        .order("name", { ascending: true })
        .limit(8),
    ) as CustomerRow[] | null;
    return (rows ?? []).map(toPosCustomer);
  });
}

const quickCustomerSchema = z.object({
  name: requiredText("Customer name", 150),
  phone: mobileRequired,
  email: emailOptional,
  gstin: gstinOptional,
  state_code: stateCodeOptional,
});

/** Quick-add a customer from the POS (needs customers.manage). */
export async function quickAddCustomerAction(input: unknown): Promise<ActionResult<PosCustomer>> {
  return runAction(quickCustomerSchema, input, { perm: "customers.manage" }, async (data, ctx) => {
    const fromGstin = data.gstin ? validateGstin(data.gstin).stateCode : undefined;
    const row = unwrap(
      await ctx.supabase
        .from("customers")
        .insert({
          business_id: ctx.business.id,
          name: data.name,
          phone: data.phone,
          email: data.email,
          gstin: data.gstin,
          state_code: data.state_code ?? fromGstin ?? null,
          created_by: ctx.user.id,
        })
        .select(CUSTOMER_COLUMNS)
        .single(),
    ) as CustomerRow | null;
    if (!row) throw new ActionError("Could not save the customer");
    return toPosCustomer(row);
  });
}

const emailReceiptSchema = z.object({ invoice_id: uuid, email: emailRequired });

/** Email the receipt of a bill that was just made. */
export async function sendReceiptEmailAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(emailReceiptSchema, input, { perm: ["sales.view_all", "sales.view_own"] }, async (data, ctx) => {
    if (!ctx.business.notify_email_enabled) throw new ActionError("Email receipts are switched off in Settings");
    unwrap(
      await ctx.supabase.rpc("send_invoice_notification", {
        p_invoice_id: data.invoice_id,
        p_channel: "email",
        p_recipient: data.email,
      }),
    );
    sendReceiptsSoon();
    return null;
  });
}

// ── Offline POS ──────────────────────────────────────────────────────────────

const outletInput = z.object({ outlet_id: uuid });

/** A fresh catalog for one outlet: prices, tax and stock. The till saves it for offline use. */
export async function refreshCatalogAction(input: unknown): Promise<ActionResult<{ version: string; catalog: CatalogProduct[] }>> {
  return runAction(outletInput, input, { perm: "sales.create" }, async (data, ctx) => {
    if (!ctx.outlets.some((o) => o.id === data.outlet_id)) throw new ActionError("You do not have access to this outlet");
    if (!ctx.can("products.view")) throw new ActionError("Your role cannot see products");
    return { version: new Date().toISOString(), catalog: await loadPosCatalog(ctx, data.outlet_id) };
  });
}

const CUSTOMER_CACHE_PAGE = 1000;
const CUSTOMER_CACHE_PAGES = 5;

/** The customers the till keeps for lookup when the network is down (most recently changed first). */
export async function customerCacheAction(): Promise<ActionResult<PosCustomer[]>> {
  return runAction(z.undefined(), undefined, { perm: "customers.view" }, async (_data, ctx) => {
    const customers: PosCustomer[] = [];
    for (let page = 0; page < CUSTOMER_CACHE_PAGES; page++) {
      const rows = unwrap(
        await ctx.supabase
          .from("customers")
          .select(CUSTOMER_COLUMNS)
          .eq("business_id", ctx.business.id)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(page * CUSTOMER_CACHE_PAGE, page * CUSTOMER_CACHE_PAGE + CUSTOMER_CACHE_PAGE - 1),
      ) as CustomerRow[] | null;
      const batch = rows ?? [];
      customers.push(...batch.map(toPosCustomer));
      if (batch.length < CUSTOMER_CACHE_PAGE) break;
    }
    return customers;
  });
}

/** Which business the offline data in this browser belongs to. */
export async function offlineScopeAction(): Promise<ActionResult<{ businessId: string; canDiscard: boolean }>> {
  return runAction(z.undefined(), undefined, {}, async (_data, ctx) => ({
    businessId: ctx.business.id,
    canDiscard: ctx.can("sales.cancel"),
  }));
}

const registerDeviceSchema = z.object({
  outlet_id: uuid,
  name: requiredText("Device name", 60),
  prefix: z
    .string()
    .transform(normalisePrefix)
    .superRefine((v, issue) => {
      const problem = validateSeriesPrefix(v);
      if (problem) issue.addIssue({ code: "custom", message: problem });
    }),
  /** SHA-256 (hex) of the secret that stays on the device. The secret itself is never sent here. */
  key_hash: z.string().regex(/^[0-9a-f]{64}$/, "Invalid device key"),
});

/**
 * Register the calling browser as a POS device with its own number series.
 * The RPC checks settings.manage again and writes the audit entry.
 */
export async function registerPosDeviceAction(input: unknown): Promise<ActionResult<{ deviceId: string; businessId: string; prefix: string; name: string }>> {
  return runAction(registerDeviceSchema, input, { perm: "settings.manage" }, async (data, ctx) => {
    if (!ctx.outlets.some((o) => o.id === data.outlet_id)) throw new ActionError("You do not have access to this outlet");
    const deviceId = unwrap(
      await ctx.supabase.rpc("register_pos_device", {
        p_outlet_id: data.outlet_id,
        p_name: data.name,
        p_prefix: data.prefix,
        p_device_key_hash: data.key_hash,
      }),
    ) as string | null;
    if (!deviceId) throw new ActionError("Could not register this device");
    revalidatePath("/app/settings/devices");
    return { deviceId, businessId: ctx.business.id, prefix: data.prefix, name: data.name };
  });
}

/**
 * The server's side of a device series: whether the device is still active and
 * the next number per financial year. The till raises its local counter to match.
 */
export async function deviceSeriesAction(
  input: unknown,
): Promise<ActionResult<{ found: boolean; active: boolean; series: Array<{ fy: string; next: number }> }>> {
  return runAction(z.object({ device_id: uuid }), input, { perm: "sales.create" }, async (data, ctx) => {
    const [deviceResult, seriesResult] = await Promise.all([
      ctx.supabase.from("pos_devices").select("id, is_active").eq("business_id", ctx.business.id).eq("id", data.device_id).maybeSingle(),
      ctx.supabase
        .from("invoice_series")
        .select("financial_year, next_number")
        .eq("business_id", ctx.business.id)
        .eq("pos_device_id", data.device_id)
        .eq("document_type", "invoice"),
    ]);
    const device = unwrap(deviceResult) as { id: string; is_active: boolean } | null;
    const rows = (unwrap(seriesResult) ?? []) as Array<{ financial_year: string; next_number: number }>;
    return {
      found: !!device,
      active: !!device?.is_active,
      series: rows.map((r) => ({ fy: r.financial_year, next: Number(r.next_number) })),
    };
  });
}
