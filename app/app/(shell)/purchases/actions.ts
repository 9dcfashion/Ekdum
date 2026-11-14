"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, describeDbError, runAction, unwrap } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { validateGstin } from "@/lib/gst";
import { ilikeTerm } from "@/lib/list";
import { PurchaseComputeError, buildPurchasePayload, isEmptyDraft, ourStateCode, postingProblems } from "@/lib/purchases/compute";
import { rankRecentProducts } from "@/lib/purchases/flow";
import type { ProductSearchResult, ProductSuggestions, PurchaseProductOption, SaveBillResult, VendorOption } from "@/lib/purchases/types";
import { BUCKETS } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuid, uuidOptional } from "@/lib/validation/common";
import {
  cancelPurchaseSchema,
  purchaseBillSchema,
  purchasePaymentSchema,
  quickPurchaseProductSchema,
  quickVendorSchema,
} from "@/lib/validation/purchases";

const idSchema = z.object({ id: uuid });

function revalidateBill(id?: string) {
  revalidatePath("/app/purchases");
  if (id) revalidatePath(`/app/purchases/${id}`);
}

/** Best effort: a file left behind in storage is harmless, a failed save is not. */
async function removeAttachments(ctx: AppContext, paths: string[]) {
  const own = paths.filter((p) => p.startsWith(`${ctx.business.id}/`));
  if (own.length === 0) return;
  try {
    await ctx.supabase.storage.from(BUCKETS.purchaseAttachments).remove(own);
  } catch {
    // ignored on purpose
  }
}

/**
 * Create or update a DRAFT purchase bill, and optionally post it.
 * Amounts are recomputed here with the GST engine; the browser's totals are never used.
 */
export async function savePurchaseBillAction(input: unknown, post: boolean) {
  return runAction(purchaseBillSchema, input, { perm: "purchases.create" }, async (data, ctx): Promise<SaveBillResult> => {
    const wantsPost = post === true;
    if (wantsPost && !ctx.can("purchases.post")) {
      throw new ActionError("You don't have permission to post purchase bills. Save it as a draft instead.");
    }

    const outlet = ctx.outlets.find((o) => o.id === data.outlet_id);
    if (!outlet) throw new ActionError("Choose an outlet you have access to", { outlet_id: ["Choose an outlet you have access to"] });

    const prefix = `${ctx.business.id}/bills/`;
    if (data.attachment_paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) {
      throw new ActionError("One of the attachments does not belong to this business");
    }
    if (isEmptyDraft(data)) {
      throw new ActionError("Attach the bill, pick a vendor or add an item before saving");
    }

    let previousPaths: string[] = [];
    if (data.id) {
      // Read through the user's session so RLS (business + outlet access) decides whether they may touch it.
      const existing = unwrap(
        await ctx.supabase
          .from("purchase_bills")
          .select("id, status, attachment_paths")
          .eq("id", data.id)
          .eq("business_id", ctx.business.id)
          .maybeSingle(),
      ) as { id: string; status: string; attachment_paths: string[] | null } | null;
      if (!existing) throw new ActionError("Purchase bill not found");
      if (existing.status !== "draft") throw new ActionError("Only draft purchase bills can be edited");
      previousPaths = existing.attachment_paths ?? [];
    }

    if (data.lines.length > 0) {
      const [rates, units] = await Promise.all([
        ctx.supabase.from("gst_rates").select("rate"),
        ctx.supabase.from("units").select("code"),
      ]);
      const knownRates = new Set(((unwrap(rates) ?? []) as { rate: number }[]).map((r) => Number(r.rate)));
      const knownUnits = new Set(((unwrap(units) ?? []) as { code: string }[]).map((u) => u.code));
      const fieldErrors: Record<string, string[]> = {};
      data.lines.forEach((line, i) => {
        if (!knownRates.has(line.gst_rate)) fieldErrors[`lines.${i}.gst_rate`] = ["Pick a GST rate from the list"];
        if (!knownUnits.has(line.unit_code)) fieldErrors[`lines.${i}.unit_code`] = ["Pick a unit from the list"];
      });
      const first = Object.keys(fieldErrors)[0];
      if (first) {
        const lineNo = Number(first.split(".")[1]) + 1;
        throw new ActionError(`Line ${lineNo}: ${fieldErrors[first][0]}`, fieldErrors);
      }
    }

    if (wantsPost) {
      const problems = postingProblems(data);
      const first = Object.values(problems)[0];
      if (first) throw new ActionError(first[0], problems);
    }

    let payload;
    try {
      payload = buildPurchasePayload({
        businessId: ctx.business.id,
        placeOfSupplyState: ourStateCode(outlet, ctx.business.gstin),
        bill: data,
      });
    } catch (error) {
      if (error instanceof PurchaseComputeError) throw new ActionError(error.message);
      throw error;
    }

    // save_purchase_bill is granted to the service role only. It checks p_actor's
    // permission and outlet access again and re-adds the totals inside one transaction.
    const admin = createAdminClient();
    const billId = unwrap(await admin.rpc("save_purchase_bill", { p_actor: ctx.user.id, p: payload })) as string;

    const kept = new Set(data.attachment_paths);
    await removeAttachments(ctx, previousPaths.filter((p) => !kept.has(p)));

    let postError: string | null = null;
    if (wantsPost) {
      const { error } = await ctx.supabase.rpc("post_purchase_bill", { p_bill_id: billId });
      if (error) postError = describeDbError(error);
      else revalidatePath("/app/inventory");
    }

    revalidateBill(billId);
    return { id: billId, posted: wantsPost && !postError, postError };
  });
}

export async function postPurchaseBillAction(input: unknown) {
  return runAction(idSchema, input, { perm: "purchases.post" }, async ({ id }, ctx) => {
    unwrap(await ctx.supabase.rpc("post_purchase_bill", { p_bill_id: id }));
    revalidateBill(id);
    revalidatePath("/app/inventory");
  });
}

/** Drafts are simply deleted (cancel_purchase_bill does that for a draft). */
export async function deleteDraftPurchaseAction(input: unknown) {
  return runAction(idSchema, input, { perm: "purchases.create" }, async ({ id }, ctx) => {
    const bill = unwrap(
      await ctx.supabase
        .from("purchase_bills")
        .select("id, status, attachment_paths")
        .eq("id", id)
        .eq("business_id", ctx.business.id)
        .maybeSingle(),
    ) as { id: string; status: string; attachment_paths: string[] | null } | null;
    if (!bill) throw new ActionError("Purchase bill not found");
    if (bill.status !== "draft") throw new ActionError("Only a draft can be deleted. Cancel a posted bill instead.");
    unwrap(await ctx.supabase.rpc("cancel_purchase_bill", { p_bill_id: id, p_reason: "" }));
    await removeAttachments(ctx, bill.attachment_paths ?? []);
    revalidateBill(id);
  });
}

export async function cancelPurchaseBillAction(input: unknown) {
  return runAction(cancelPurchaseSchema, input, { perm: "purchases.post" }, async ({ id, reason }, ctx) => {
    const bill = unwrap(
      await ctx.supabase.from("purchase_bills").select("id, status").eq("id", id).eq("business_id", ctx.business.id).maybeSingle(),
    ) as { id: string; status: string } | null;
    if (!bill) throw new ActionError("Purchase bill not found");
    // A draft would be deleted by the same function; this action is only for posted bills.
    if (bill.status !== "posted") throw new ActionError(`This purchase bill is ${bill.status}, so it cannot be cancelled`);
    unwrap(await ctx.supabase.rpc("cancel_purchase_bill", { p_bill_id: id, p_reason: reason }));
    revalidateBill(id);
    revalidatePath("/app/inventory");
  });
}

export async function recordPurchasePaymentAction(input: unknown) {
  return runAction(purchasePaymentSchema, input, { perm: "purchases.create" }, async (data, ctx) => {
    const bill = unwrap(
      await ctx.supabase
        .from("purchase_bills")
        .select("id, status, total_paise, amount_paid_paise")
        .eq("id", data.bill_id)
        .eq("business_id", ctx.business.id)
        .maybeSingle(),
    ) as { id: string; status: string; total_paise: number; amount_paid_paise: number } | null;
    if (!bill) throw new ActionError("Purchase bill not found");
    if (bill.status !== "posted") throw new ActionError("Payments can only be recorded against a posted purchase bill");
    if (data.amount > Number(bill.total_paise) - Number(bill.amount_paid_paise)) {
      throw new ActionError("That is more than the amount still to be paid", { amount: ["More than the amount still to be paid"] });
    }
    // The trigger on purchase_payments keeps amount_paid_paise / payment_status in step and rejects overpayment.
    unwrap(
      await ctx.supabase.from("purchase_payments").insert({
        purchase_bill_id: bill.id,
        business_id: ctx.business.id,
        amount_paise: data.amount,
        mode: data.mode,
        paid_on: data.paid_on,
        reference: data.reference,
        created_by: ctx.user.id,
      }),
    );
    revalidateBill(bill.id);
  });
}

export async function deletePurchasePaymentAction(input: unknown) {
  return runAction(idSchema, input, { perm: "purchases.post" }, async ({ id }, ctx) => {
    const deleted = unwrap(
      await ctx.supabase.from("purchase_payments").delete().eq("id", id).eq("business_id", ctx.business.id).select("purchase_bill_id"),
    ) as { purchase_bill_id: string }[] | null;
    if (!deleted || deleted.length === 0) throw new ActionError("Payment not found");
    revalidateBill(deleted[0].purchase_bill_id);
  });
}

/** "Create vendor" from inside the purchase form. */
export async function createVendorInlineAction(input: unknown) {
  return runAction(quickVendorSchema, input, { perm: "vendors.manage" }, async (data, ctx): Promise<VendorOption> => {
    const fromGstin = data.gstin ? validateGstin(data.gstin).stateCode : undefined;
    const row = unwrap(
      await ctx.supabase
        .from("vendors")
        .insert({
          business_id: ctx.business.id,
          name: data.name,
          gstin: data.gstin,
          phone: data.phone,
          state_code: fromGstin ?? data.state_code,
          created_by: ctx.user.id,
        })
        .select("id, name, gstin, state_code, phone")
        .single(),
    ) as VendorOption;
    revalidatePath("/app/vendors");
    return row;
  });
}

/** "Create product" from inside the purchase form. Stock arrives when the bill is posted. */
export async function createProductInlineAction(input: unknown) {
  return runAction(quickPurchaseProductSchema, input, { perm: "products.manage" }, async (data, ctx): Promise<PurchaseProductOption> => {
    const [rate, unit] = await Promise.all([
      ctx.supabase.from("gst_rates").select("rate").eq("rate", data.gst_rate).eq("is_active", true).maybeSingle(),
      ctx.supabase.from("units").select("code").eq("code", data.unit_code).maybeSingle(),
    ]);
    if (!unwrap(rate)) throw new ActionError("Pick a GST rate from the list", { gst_rate: ["Pick a GST rate from the list"] });
    if (!unwrap(unit)) throw new ActionError("Pick a unit from the list", { unit_code: ["Pick a unit from the list"] });
    const row = unwrap(
      await ctx.supabase
        .from("products")
        .insert({
          business_id: ctx.business.id,
          name: data.name,
          unit_code: data.unit_code,
          gst_rate: data.gst_rate,
          hsn_code: data.hsn_code,
          sale_price_paise: data.sale_price,
          created_by: ctx.user.id,
        })
        .select("id, name, sku, barcode, hsn_code, unit_code, gst_rate, cess_rate")
        .single(),
    ) as Omit<PurchaseProductOption, "cost_paise" | "stock">;
    revalidatePath("/app/products");
    return { ...row, gst_rate: Number(row.gst_rate), cess_rate: Number(row.cess_rate), cost_paise: null, stock: null };
  });
}

const PRODUCT_COLUMNS = "id, name, sku, barcode, hsn_code, unit_code, gst_rate, cess_rate, track_inventory";
type ProductRow = Omit<PurchaseProductOption, "cost_paise" | "stock"> & { track_inventory: boolean };

/**
 * Add the last purchase rate (only for users who may see costs) and the stock at
 * the bill's outlet (only for users who may see stock there) to product rows.
 */
async function withCostAndStock(ctx: AppContext, rows: ProductRow[], outletId: string | null): Promise<PurchaseProductOption[]> {
  const ids = rows.map((r) => r.id);
  const outlet = outletId && ctx.outlets.some((o) => o.id === outletId) ? outletId : null;
  const showStock = !!outlet && ctx.can("inventory.view");
  const costs = new Map<string, number>();
  const stock = new Map<string, number>();
  if (ids.length > 0) {
    const [costRows, stockRows] = await Promise.all([
      ctx.can("products.view_cost")
        ? ctx.supabase.from("product_costs").select("product_id, purchase_price_paise").in("product_id", ids)
        : Promise.resolve({ data: [] }),
      showStock
        ? ctx.supabase.from("stock_levels").select("product_id, quantity").eq("outlet_id", outlet).in("product_id", ids)
        : Promise.resolve({ data: [] }),
    ]);
    for (const c of (costRows.data ?? []) as { product_id: string; purchase_price_paise: number }[]) {
      costs.set(c.product_id, Number(c.purchase_price_paise));
    }
    for (const l of (stockRows.data ?? []) as { product_id: string; quantity: number | string }[]) {
      stock.set(l.product_id, Number(l.quantity));
    }
  }
  return rows.map(({ track_inventory, ...r }) => ({
    ...r,
    gst_rate: Number(r.gst_rate),
    cess_rate: Number(r.cess_rate),
    cost_paise: costs.get(r.id) ?? null,
    stock: showStock && track_inventory ? (stock.get(r.id) ?? 0) : null,
  }));
}

/** Product search for the line picker: name, SKU or barcode. A scanned barcode comes back as `exactId`. */
export async function searchPurchaseProductsAction(input: unknown) {
  return runAction(
    z.object({ q: z.string().trim().max(100), outlet_id: uuidOptional }),
    input,
    { perm: "purchases.create" },
    async ({ q, outlet_id }, ctx): Promise<ProductSearchResult> => {
      const term = ilikeTerm(q);
      if (!term) return { results: [], exactId: null };
      const base = () => ctx.supabase.from("products").select(PRODUCT_COLUMNS).eq("business_id", ctx.business.id).eq("is_active", true);
      // Inside or=(...) a quoted value is taken literally; quotes and backslashes are stripped first.
      const exactValue = q.replace(/["\\]/g, " ").trim();
      const [exact, fuzzy] = await Promise.all([
        exactValue ? base().or(`barcode.eq."${exactValue}",sku.eq."${exactValue}"`).limit(2) : Promise.resolve({ data: [], error: null }),
        base().or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`).order("name").limit(12),
      ]);
      const exactRows = ((exact.error ? [] : exact.data) ?? []) as ProductRow[];
      const fuzzyRows = (unwrap(fuzzy) ?? []) as ProductRow[];
      const seen = new Set<string>();
      const rows = [...exactRows, ...fuzzyRows].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      return {
        results: await withCostAndStock(ctx, rows, outlet_id),
        exactId: exactRows.length === 1 ? exactRows[0].id : null,
      };
    },
  );
}

/**
 * What to show before anything is typed in the item search: products bought
 * from this supplier on their latest bills, else products bought recently from anyone.
 */
export async function suggestPurchaseProductsAction(input: unknown) {
  return runAction(
    z.object({ vendor_id: uuidOptional, outlet_id: uuidOptional }),
    input,
    { perm: "purchases.create" },
    async ({ vendor_id, outlet_id }, ctx): Promise<ProductSuggestions> => {
      const latestBills = async (vendorId: string | null) => {
        let query = ctx.supabase
          .from("purchase_bills")
          .select("id")
          .eq("business_id", ctx.business.id)
          .neq("status", "cancelled")
          .order("created_at", { ascending: false })
          .limit(vendorId ? 8 : 15);
        if (vendorId) query = query.eq("vendor_id", vendorId);
        const { data } = await query;
        return ((data ?? []) as { id: string }[]).map((b) => b.id);
      };
      let source: ProductSuggestions["source"] = "recent";
      let billIds = vendor_id ? await latestBills(vendor_id) : [];
      if (billIds.length > 0) source = "vendor";
      else billIds = await latestBills(null);
      if (billIds.length === 0) return { source, results: [] };

      const { data: items } = await ctx.supabase
        .from("purchase_bill_items")
        .select("purchase_bill_id, product_id, line_no")
        .in("purchase_bill_id", billIds)
        .not("product_id", "is", null)
        .limit(400);
      const ids = rankRecentProducts(billIds, (items ?? []) as { purchase_bill_id: string; product_id: string | null; line_no: number }[], 12);
      if (ids.length === 0) return { source, results: [] };

      const { data: products } = await ctx.supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("business_id", ctx.business.id)
        .eq("is_active", true)
        .in("id", ids);
      const byId = new Map(((products ?? []) as ProductRow[]).map((p) => [p.id, p]));
      const rows = ids.map((id) => byId.get(id)).filter((p): p is ProductRow => !!p);
      return { source, results: await withCostAndStock(ctx, rows, outlet_id) };
    },
  );
}
