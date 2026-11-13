import { z } from "zod";
import { istDateString } from "@/lib/dates";
import { rupeesToPaise } from "@/lib/money";
import {
  gstinOptional,
  hsnOptional,
  optionalText,
  percentRequired,
  phoneLooseOptional,
  quantityRequired,
  requiredText,
  rupeesOptional,
  rupeesRequired,
  stateCodeOptional,
  uuid,
  uuidOptional,
} from "./common";

export const PURCHASE_PAYMENT_MODES = ["cash", "upi", "card", "bank_transfer", "cheque"] as const;
export type PurchasePaymentMode = (typeof PURCHASE_PAYMENT_MODES)[number];

export const PURCHASE_PAYMENT_MODE_LABELS: Record<PurchasePaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
};

/** The manual round-off only bridges paise differences with the vendor's printed total. */
export const MAX_ROUND_OFF_PAISE = 99;
export const MAX_ATTACHMENTS = 10;
export const MAX_LINES = 200;
const MAX_PAISE = 99_99_99_99_999;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Optional date that may not be in the future (IST). "" → null. */
const pastDateOptional = (label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => v === null || isRealDate(v), "Enter a valid date")
    .refine((v) => v === null || v <= istDateString(), `${label} cannot be in the future`);

/** "-0.40" | "0.4" | "" → signed paise, within ± MAX_ROUND_OFF_PAISE. */
const roundOffRupees = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || String(v).trim() === "") return 0;
    const paise = rupeesToPaise(v);
    if (paise === null || Math.abs(paise) > MAX_ROUND_OFF_PAISE) {
      ctx.addIssue({ code: "custom", message: "Round-off must be between -0.99 and 0.99" });
      return z.NEVER;
    }
    return paise;
  });

export const purchaseLineSchema = z
  .object({
    /** Null for a free-text expense line: it never touches stock. */
    product_id: uuidOptional,
    description: requiredText("Item name", 200),
    hsn_code: hsnOptional,
    quantity: quantityRequired,
    unit_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, "Select a unit"),
    /** Rate per unit, typed in rupees. */
    rate: rupeesRequired("Rate").refine((v) => v <= MAX_PAISE, "Rate is too large"),
    price_includes_tax: z.boolean(),
    /** Line discount, typed in rupees. */
    discount: rupeesOptional("Discount").transform((v) => v ?? 0),
    gst_rate: percentRequired,
    cess_rate: z
      .union([z.string(), z.number()])
      .nullish()
      .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? 0 : v))
      .pipe(percentRequired),
  })
  .transform(({ rate, discount, ...rest }) => ({ ...rest, rate_paise: rate, discount_paise: discount }));

export const purchaseBillSchema = z
  .object({
    /** Present when editing an existing draft. */
    id: uuidOptional,
    outlet_id: uuid,
    vendor_id: uuidOptional,
    vendor_invoice_number: optionalText(50),
    vendor_invoice_date: pastDateOptional("The bill date"),
    /** True → IGST, false → CGST + SGST. Suggested from the states, but the user decides. */
    is_inter_state: z.boolean(),
    round_off: roundOffRupees,
    notes: optionalText(1000),
    attachment_paths: z.array(z.string().trim().min(1).max(300)).max(MAX_ATTACHMENTS, `Attach up to ${MAX_ATTACHMENTS} files`),
    lines: z.array(purchaseLineSchema).max(MAX_LINES, `A bill can have up to ${MAX_LINES} lines`),
  })
  .transform(({ round_off, ...rest }) => ({ ...rest, round_off_paise: round_off }));

export type PurchaseBillInput = z.input<typeof purchaseBillSchema>;
export type PurchaseBillData = z.output<typeof purchaseBillSchema>;
export type PurchaseLineInput = z.input<typeof purchaseLineSchema>;
export type PurchaseLineData = z.output<typeof purchaseLineSchema>;

export const purchasePaymentSchema = z.object({
  bill_id: uuid,
  amount: rupeesRequired("Amount").refine((v) => v > 0, "Amount must be more than zero"),
  mode: z.enum(PURCHASE_PAYMENT_MODES, "Select how it was paid"),
  paid_on: z
    .string()
    .trim()
    .refine(isRealDate, "Enter a valid date")
    .refine((v) => v <= istDateString(), "The payment date cannot be in the future"),
  reference: optionalText(100),
});
export type PurchasePaymentInput = z.input<typeof purchasePaymentSchema>;

export const cancelPurchaseSchema = z.object({
  id: uuid,
  reason: requiredText("Reason", 300),
});
export type CancelPurchaseInput = z.input<typeof cancelPurchaseSchema>;

/** Vendor created from inside the purchase form (the full form lives under Vendors). */
export const quickVendorSchema = z.object({
  name: requiredText("Vendor name", 150),
  gstin: gstinOptional,
  phone: phoneLooseOptional,
  state_code: stateCodeOptional,
});
export type QuickVendorInput = z.input<typeof quickVendorSchema>;

/** Product created from inside the purchase form (the full form lives under Products). */
export const quickPurchaseProductSchema = z.object({
  name: requiredText("Product name", 200),
  unit_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, "Select a unit"),
  gst_rate: percentRequired,
  hsn_code: hsnOptional,
  sale_price: rupeesRequired("Selling price").refine((v) => v <= MAX_PAISE, "Selling price is too large"),
});
export type QuickPurchaseProductInput = z.input<typeof quickPurchaseProductSchema>;
