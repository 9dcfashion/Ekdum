import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContext } from "@/lib/auth/context";
import { istDateString } from "@/lib/dates";
import {
  GstEngineError,
  amountInWords,
  chargesTax,
  computeInvoice,
  diffTotals,
  discountPercent,
  isInterState as isInterStateSupply,
  resolveDocumentType,
  resolvePlaceOfSupply,
  sellerStateCode,
  TOTAL_MISMATCH_TOLERANCE_PAISE,
  UNREGISTERED_RECIPIENT_DETAILS_THRESHOLD_PAISE,
  type InvoiceTotals,
} from "@/lib/gst";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InvoiceSource } from "@/lib/types/db";
import type { SaleData } from "@/lib/validation/sales";

export type PostErrorCode =
  | "forbidden"
  | "invalid"
  | "totals_mismatch"
  | "number_conflict"
  | "number_invalid"
  | "device_invalid"
  | "insufficient_stock"
  | "discount_over_limit"
  | "price_override_denied"
  | "series_missing"
  | "server_error";

export interface PostWarning {
  code: string;
  message: string;
}

export type PostResult =
  | {
      ok: true;
      invoiceId: string;
      invoiceNumber: string;
      publicToken: string;
      /** True when this client_uuid had already been posted (a safe retry). */
      duplicate: boolean;
      warnings: PostWarning[];
    }
  | {
      ok: false;
      code: PostErrorCode;
      message: string;
      /** For totals_mismatch: what the server computed, so the client can show the difference. */
      serverTotals?: Omit<InvoiceTotals, "lines">;
    };

const HINT_CODES: Record<string, PostErrorCode> = {
  number_conflict: "number_conflict",
  number_invalid: "number_invalid",
  device_invalid: "device_invalid",
  device_inactive: "device_invalid",
  insufficient_stock: "insufficient_stock",
  discount_over_limit: "discount_over_limit",
  price_override_denied: "price_override_denied",
  series_missing: "series_missing",
};

export function hashDeviceKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * The one place a sale becomes an invoice. Used by the POS action, the back
 * office and the offline sync endpoint.
 *
 *  1. Re-checks the caller's permission and outlet access (never trusts the client).
 *  2. Recomputes every amount with the shared GST engine and compares with the
 *     totals the client showed the cashier. Any difference is rejected.
 *  3. Calls the post_sales_invoice RPC (service role), which allocates/validates
 *     the number, writes invoice + lines + payments + stock + outbox in one transaction.
 *
 * `data` must already be parsed with saleInputSchema.
 */
export async function postInvoice(ctx: AppContext, data: SaleData, source: InvoiceSource): Promise<PostResult> {
  if (!ctx.can("sales.create")) {
    return { ok: false, code: "forbidden", message: "You are not allowed to create bills" };
  }
  const outlet = ctx.outlets.find((o) => o.id === data.outlet_id);
  if (!outlet) {
    return { ok: false, code: "forbidden", message: "You do not have access to this outlet" };
  }
  const business = ctx.business;
  const offline = source === "pos_offline";

  // ── Customer rules ────────────────────────────────────────────────────────
  if (data.supply_type === "b2b" && !data.customer.gstin) {
    return { ok: false, code: "invalid", message: "A B2B bill needs the customer's GSTIN" };
  }
  if (data.supply_type === "b2b" && !data.customer.name) {
    return { ok: false, code: "invalid", message: "A B2B bill needs the customer's name" };
  }
  if (data.payments.some((p) => p.mode === "credit") && !data.customer_id) {
    return { ok: false, code: "invalid", message: "Select a customer to give credit" };
  }

  // ── Tax position ──────────────────────────────────────────────────────────
  const taxed = chargesTax(business.gst_scheme);
  const sellerState = sellerStateCode({ gstin: taxed || business.gst_scheme === "composition" ? (outlet.gstin ?? business.gstin) : null, state_code: outlet.state_code });
  const placeOfSupply = resolvePlaceOfSupply({
    sellerState,
    supplyType: data.supply_type,
    customerGstin: data.customer.gstin,
    customerStateCode: data.customer.state_code,
    deliveryStateCode: data.delivery_state_code,
    overrideStateCode: data.place_of_supply_override?.state_code,
  });
  const interState = isInterStateSupply(sellerState, placeOfSupply.stateCode);

  // ── Recompute with the same engine the client used ────────────────────────
  let totals: InvoiceTotals;
  try {
    totals = computeInvoice({
      lines: data.lines.map((l) => ({
        quantity: l.quantity,
        unitPricePaise: l.unit_price_paise,
        priceIncludesTax: l.price_includes_tax,
        discountPaise: l.discount_paise,
        gstRate: l.gst_rate,
        cessRate: l.cess_rate,
      })),
      billDiscountPaise: data.bill_discount_paise,
      chargeTax: taxed,
      isInterState: interState,
      roundOff: business.round_off_enabled,
    });
  } catch (error) {
    if (error instanceof GstEngineError) {
      const where = error.lineIndex !== undefined ? `Line ${error.lineIndex + 1}: ` : "";
      return { ok: false, code: "invalid", message: `${where}${error.message}` };
    }
    throw error;
  }

  const { lines: computedLines, ...serverTotals } = totals;
  const differences = diffTotals(serverTotals, data.totals, TOTAL_MISMATCH_TOLERANCE_PAISE);
  if (differences.length > 0) {
    return {
      ok: false,
      code: "totals_mismatch",
      message: "The bill total does not match the server's calculation. Please review the bill and try again.",
      serverTotals,
    };
  }

  // A friendly early check; the database enforces the same limit authoritatively.
  if (!offline && totals.discountPaise > 0) {
    const limit = ctx.can("sales.discount") ? Number(ctx.role.max_discount_percent) : 0;
    const given = discountPercent(totals.discountPaise, totals.subtotalPaise);
    if (given > limit) {
      return {
        ok: false,
        code: "discount_over_limit",
        message: limit > 0 ? `Discount of ${given}% is above your limit of ${limit}%` : "You are not allowed to give discounts",
      };
    }
  }

  const documentType = resolveDocumentType({
    scheme: business.gst_scheme,
    lineGstRates: computedLines.map((l) => l.gstRate),
    bosForExemptOnly: business.bos_for_exempt_only,
  });

  // Rule 46: an unregistered buyer's name, address and state must be on a tax
  // invoice once the taxable value reaches the threshold (see COMPLIANCE_NOTES 6.1).
  // An offline bill has already been printed, so it is accepted and flagged instead.
  const needsRecipientDetails =
    documentType === "tax_invoice" &&
    data.supply_type === "b2c" &&
    totals.taxablePaise >= UNREGISTERED_RECIPIENT_DETAILS_THRESHOLD_PAISE &&
    !(data.customer.name && data.customer.address && (data.customer.state_code || data.delivery_state_code));
  if (needsRecipientDetails && !offline) {
    return {
      ok: false,
      code: "invalid",
      message: "For a bill of ₹50,000 or more, add the customer's name, address and state.",
    };
  }

  const admin = createAdminClient();

  // ── Registered POS device: verify its secret, then let it use its own series ──
  let deviceId: string | null = null;
  if (data.device) {
    const { data: device } = await admin
      .from("pos_devices")
      .select("id, business_id, outlet_id, device_key_hash, is_active")
      .eq("id", data.device.id)
      .maybeSingle();
    if (
      !device ||
      device.business_id !== business.id ||
      device.outlet_id !== outlet.id ||
      !safeEqualHex(hashDeviceKey(data.device.key), device.device_key_hash as string)
    ) {
      return { ok: false, code: "device_invalid", message: "This POS device is not registered for this outlet. Register it again in Settings → POS devices." };
    }
    if (!device.is_active) {
      return { ok: false, code: "device_invalid", message: "This POS device has been deactivated" };
    }
    if (!data.invoice_number) {
      return { ok: false, code: "number_invalid", message: "The device did not send a bill number" };
    }
    deviceId = device.id as string;
  } else if (offline) {
    return { ok: false, code: "device_invalid", message: "Offline bills can only come from a registered POS device" };
  }

  const payload = {
    business_id: business.id,
    outlet_id: outlet.id,
    client_uuid: data.client_uuid,
    source,
    device_id: deviceId,
    invoice_number: deviceId ? data.invoice_number : null,
    invoice_date: offline ? (data.invoice_date ?? istDateString()) : null,
    document_type: documentType,
    supply_type: data.supply_type,
    customer_id: data.customer_id,
    customer: data.customer,
    place_of_supply_state: placeOfSupply.stateCode,
    pos_override_reason: data.place_of_supply_override?.reason ?? null,
    is_inter_state: interState,
    reverse_charge: false,
    subtotal_paise: totals.subtotalPaise,
    discount_paise: totals.discountPaise,
    taxable_paise: totals.taxablePaise,
    cgst_paise: totals.cgstPaise,
    sgst_paise: totals.sgstPaise,
    igst_paise: totals.igstPaise,
    cess_paise: totals.cessPaise,
    round_off_paise: totals.roundOffPaise,
    total_paise: totals.totalPaise,
    amount_in_words: amountInWords(totals.totalPaise),
    // 32 random bytes: unguessable link for /i/{token}.
    public_token: randomBytes(32).toString("base64url"),
    notes: data.notes,
    items: data.lines.map((line, i) => {
      const c = computedLines[i];
      return {
        product_id: line.product_id,
        description: line.description,
        hsn_code: line.hsn_code,
        quantity: line.quantity,
        unit_code: line.unit_code,
        unit_price_paise: line.unit_price_paise,
        price_includes_tax: line.price_includes_tax,
        discount_paise: c.discountPaise,
        taxable_paise: c.taxablePaise,
        gst_rate: c.gstRate,
        cess_rate: c.cessRate,
        cgst_paise: c.cgstPaise,
        sgst_paise: c.sgstPaise,
        igst_paise: c.igstPaise,
        cess_paise: c.cessPaise,
        total_paise: c.totalPaise,
      };
    }),
    payments: data.payments.map((p) => ({ mode: p.mode, amount_paise: p.amount_paise, reference: p.reference })),
    notify: data.notify,
    whatsapp_opt_in: data.whatsapp_opt_in,
  };

  const { data: result, error } = await admin.rpc("post_sales_invoice", { p_actor: ctx.user.id, p: payload });
  if (error) {
    const code = HINT_CODES[error.hint ?? ""] ?? (error.code === "42501" ? "forbidden" : error.code === "P0001" ? "invalid" : "server_error");
    if (code === "server_error") {
      console.error("[post_sales_invoice]", error.code, error.message);
      // A unique violation here means two requests raced for the same number or client_uuid.
      if (error.code === "23505") {
        return { ok: false, code: "number_conflict", message: "That bill number was just used. Please try again." };
      }
      return { ok: false, code, message: "Could not save the bill. Please try again." };
    }
    return { ok: false, code, message: error.message };
  }

  const r = result as { invoice_id: string; invoice_number: string; public_token: string; duplicate: boolean; warnings: PostWarning[] };
  const warnings = [...(r.warnings ?? [])];
  if (needsRecipientDetails && !r.duplicate) {
    warnings.push({
      code: "recipient_details_missing",
      message: "This bill is ₹50,000 or more but has no customer name, address and state.",
    });
  }
  return {
    ok: true,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    publicToken: r.public_token,
    duplicate: r.duplicate,
    warnings,
  };
}
