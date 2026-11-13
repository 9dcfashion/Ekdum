import { paiseToRupees } from "@/lib/money";
import type { PurchaseBillInput, PurchaseLineInput } from "@/lib/validation/purchases";

/**
 * The seam for "attach bill → draft → review → post".
 *
 * A purchase form is always opened from a `DraftPrefill`: an empty one for a new
 * bill, one built from the saved row when a draft is edited. In Phase 2 an AI
 * reader will produce the same shape from the attached photo or PDF
 * (`source: "attachment_ai"`), and nothing else in the form has to change.
 * Every field is optional because a reader may only make out part of a bill.
 */
export type DraftPrefillSource = "manual" | "saved_draft" | "attachment_ai";

export interface DraftPrefillLine {
  product_id?: string | null;
  description?: string | null;
  hsn_code?: string | null;
  quantity?: string | number | null;
  unit_code?: string | null;
  rate_paise?: number | null;
  price_includes_tax?: boolean | null;
  discount_paise?: number | null;
  gst_rate?: string | number | null;
  cess_rate?: string | number | null;
}

export interface DraftPrefill {
  source: DraftPrefillSource;
  id?: string | null;
  outlet_id?: string | null;
  vendor_id?: string | null;
  vendor_invoice_number?: string | null;
  vendor_invoice_date?: string | null;
  /** Leave undefined to let the form suggest it from the vendor's and outlet's states. */
  is_inter_state?: boolean | null;
  round_off_paise?: number | null;
  notes?: string | null;
  attachment_paths?: string[] | null;
  lines?: DraftPrefillLine[] | null;
}

export const EMPTY_PREFILL: DraftPrefill = { source: "manual" };

/** "18.00" | 18 → "18"; "0.25" → "0.25". Matches the option values of the GST rate select. */
export function rateValue(rate: string | number | null | undefined): string {
  const n = Number(rate ?? 0);
  return Number.isFinite(n) ? String(n) : "0";
}

const money = (paise: number | null | undefined, blankWhenZero = false): string =>
  paise === null || paise === undefined || (blankWhenZero && paise === 0) ? "" : paiseToRupees(paise);

export function prefillLineToForm(line: DraftPrefillLine): PurchaseLineInput {
  return {
    product_id: line.product_id ?? "",
    description: line.description ?? "",
    hsn_code: line.hsn_code ?? "",
    quantity: line.quantity === null || line.quantity === undefined ? "1" : String(Number(line.quantity)),
    unit_code: line.unit_code ?? "PCS",
    rate: money(line.rate_paise),
    price_includes_tax: line.price_includes_tax ?? false,
    discount: money(line.discount_paise, true),
    gst_rate: rateValue(line.gst_rate),
    cess_rate: rateValue(line.cess_rate),
  };
}

/** Form values for a prefill. `fallback` supplies what the prefill does not say. */
export function prefillToFormValues(
  prefill: DraftPrefill,
  fallback: { outletId: string; isInterState: boolean },
): PurchaseBillInput {
  return {
    id: prefill.id ?? "",
    outlet_id: prefill.outlet_id ?? fallback.outletId,
    vendor_id: prefill.vendor_id ?? "",
    vendor_invoice_number: prefill.vendor_invoice_number ?? "",
    vendor_invoice_date: prefill.vendor_invoice_date ?? "",
    is_inter_state: prefill.is_inter_state ?? fallback.isInterState,
    round_off: prefill.round_off_paise ? paiseToRupees(prefill.round_off_paise) : "",
    notes: prefill.notes ?? "",
    attachment_paths: [...(prefill.attachment_paths ?? [])],
    lines: (prefill.lines ?? []).map(prefillLineToForm),
  };
}

/** A saved draft, as a prefill (the edit page uses the same path as a new bill). */
export function billToPrefill(
  bill: {
    id: string;
    outlet_id: string;
    vendor_id: string | null;
    vendor_invoice_number: string | null;
    vendor_invoice_date: string | null;
    is_inter_state: boolean;
    round_off_paise: number;
    notes: string | null;
    attachment_paths: string[] | null;
  },
  items: Array<{
    product_id: string | null;
    description: string;
    hsn_code: string | null;
    quantity: number | string;
    unit_code: string;
    rate_paise: number;
    price_includes_tax: boolean;
    discount_paise: number;
    gst_rate: number | string;
    cess_rate: number | string;
  }>,
): DraftPrefill {
  return {
    source: "saved_draft",
    id: bill.id,
    outlet_id: bill.outlet_id,
    vendor_id: bill.vendor_id,
    vendor_invoice_number: bill.vendor_invoice_number,
    vendor_invoice_date: bill.vendor_invoice_date,
    is_inter_state: bill.is_inter_state,
    round_off_paise: Number(bill.round_off_paise),
    notes: bill.notes,
    attachment_paths: bill.attachment_paths ?? [],
    lines: items.map((i) => ({
      product_id: i.product_id,
      description: i.description,
      hsn_code: i.hsn_code,
      quantity: i.quantity,
      unit_code: i.unit_code,
      rate_paise: Number(i.rate_paise),
      price_includes_tax: i.price_includes_tax,
      discount_paise: Number(i.discount_paise),
      gst_rate: i.gst_rate,
      cess_rate: i.cess_rate,
    })),
  };
}
