import { Decimal } from "@/lib/money";
import type { DocumentType, GstScheme } from "./config";
import { validateGstin } from "./gstin";
import { isValidStateCode } from "./states";

/** Only regular-scheme taxpayers charge GST on their bills. */
export function chargesTax(scheme: GstScheme): boolean {
  return scheme === "regular";
}

/**
 * Which document a sale produces (section 8.1).
 * regular → Tax Invoice, unless every line is nil-rated/exempt and the business
 * has `bosForExemptOnly` on, in which case it is a Bill of Supply.
 */
export function resolveDocumentType(args: {
  scheme: GstScheme;
  lineGstRates: Array<string | number>;
  bosForExemptOnly: boolean;
}): DocumentType {
  if (args.scheme === "composition") return "bill_of_supply";
  if (args.scheme === "unregistered") return "cash_memo";
  const allExempt =
    args.lineGstRates.length > 0 && args.lineGstRates.every((r) => new Decimal(r || 0).isZero());
  return allExempt && args.bosForExemptOnly ? "bill_of_supply" : "tax_invoice";
}

/** The seller's state for tax purposes: the outlet GSTIN's state, else the outlet address state. */
export function sellerStateCode(outlet: { gstin?: string | null; state_code: string }): string {
  const parsed = validateGstin(outlet.gstin);
  return parsed.valid && parsed.stateCode ? parsed.stateCode : outlet.state_code;
}

export type PlaceOfSupplySource = "override" | "delivery" | "customer_gstin" | "customer_state" | "outlet";

/**
 * Place of supply (section 8.2), in priority order:
 * cashier override → delivery address state (goods shipped) → B2B customer's
 * GSTIN state → B2B customer's billing state → the outlet's state (walk-in).
 */
export function resolvePlaceOfSupply(args: {
  sellerState: string;
  supplyType: "b2b" | "b2c";
  customerGstin?: string | null;
  customerStateCode?: string | null;
  deliveryStateCode?: string | null;
  overrideStateCode?: string | null;
}): { stateCode: string; source: PlaceOfSupplySource } {
  if (isValidStateCode(args.overrideStateCode)) {
    return { stateCode: args.overrideStateCode!, source: "override" };
  }
  if (isValidStateCode(args.deliveryStateCode)) {
    return { stateCode: args.deliveryStateCode!, source: "delivery" };
  }
  if (args.supplyType === "b2b") {
    const parsed = validateGstin(args.customerGstin);
    if (parsed.valid && parsed.stateCode) return { stateCode: parsed.stateCode, source: "customer_gstin" };
    if (isValidStateCode(args.customerStateCode)) {
      return { stateCode: args.customerStateCode!, source: "customer_state" };
    }
  }
  return { stateCode: args.sellerState, source: "outlet" };
}

/** Different states → IGST. Same state → CGST + SGST. */
export function isInterState(sellerState: string, placeOfSupplyState: string): boolean {
  return sellerState !== placeOfSupplyState;
}

/** UPI deep link / QR payload for collecting an exact amount. */
export function upiPaymentUri(args: {
  upiId: string;
  payeeName: string;
  amountPaise?: number;
  note?: string;
}): string {
  const params = new URLSearchParams({ pa: args.upiId, pn: args.payeeName.slice(0, 50), cu: "INR" });
  if (args.amountPaise && args.amountPaise > 0) {
    params.set("am", new Decimal(args.amountPaise).dividedBy(100).toFixed(2));
  }
  if (args.note) params.set("tn", args.note.slice(0, 50));
  return `upi://pay?${params.toString()}`;
}
