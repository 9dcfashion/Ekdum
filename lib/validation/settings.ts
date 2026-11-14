import { z } from "zod";
import { optionalText, requiredText, uuid, uuidOptional } from "./common";
import { outletSchema, seriesPrefix, signatoryLabel } from "./onboarding";

/** A whole number typed into a form field (forms submit strings). */
export const wholeNumber = (label: string, min: number, max: number) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const s = String(v).trim();
    const n = Number(s);
    if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `${label} must be a whole number from ${min} to ${max}` });
      return z.NEVER;
    }
    return n;
  });

export const CANCEL_WINDOW_MODES = ["same_day", "days", "no_limit"] as const;

/** What the form validates. Its output is still form-shaped, so the same values can be sent to the action. */
export const invoicePrefsFormSchema = z
  .object({
    default_print_format: z.enum(["a4", "thermal_80", "thermal_58"]),
    round_off_enabled: z.boolean(),
    invoice_terms: optionalText(1000),
    invoice_footer: optionalText(300),
    signatory_label: signatoryLabel,
    hsn_digits: z.enum(["4", "6", "8"], "Choose 4, 6 or 8 digits"),
    bos_for_exempt_only: z.boolean(),
    cancel_window_mode: z.enum(CANCEL_WINDOW_MODES),
    /** Only read when the mode is "days". */
    cancel_window_days: z.union([z.string(), z.number()]).nullish(),
    allow_negative_stock: z.boolean(),
    stuck_shipment_days: wholeNumber("Days", 1, 60),
  })
  .superRefine((v, ctx) => {
    if (v.cancel_window_mode === "days" && !wholeNumber("Days", 1, 365).safeParse(v.cancel_window_days ?? "").success) {
      ctx.addIssue({ code: "custom", path: ["cancel_window_days"], message: "Enter the number of days (1 to 365)" });
    }
  });

/** What the action saves: the columns of `businesses` (cancel_window_days: 0 = same day, n = n days, null = no limit). */
export const invoicePrefsSchema = invoicePrefsFormSchema.transform((v) => ({
  default_print_format: v.default_print_format,
  round_off_enabled: v.round_off_enabled,
  invoice_terms: v.invoice_terms,
  invoice_footer: v.invoice_footer,
  signatory_label: v.signatory_label,
  hsn_digits: Number(v.hsn_digits) as 4 | 6 | 8,
  bos_for_exempt_only: v.bos_for_exempt_only,
  cancel_window_days: v.cancel_window_mode === "no_limit" ? null : v.cancel_window_mode === "same_day" ? 0 : Number(String(v.cancel_window_days).trim()),
  allow_negative_stock: v.allow_negative_stock,
  stuck_shipment_days: v.stuck_shipment_days,
}));

export const outletCreateSchema = z.object({ outlet: outletSchema, invoice_prefix: seriesPrefix });
export const outletUpdateSchema = z.object({ id: uuid, outlet: outletSchema, is_active: z.boolean() });

export const seriesCreateSchema = z.object({
  outlet_id: uuid,
  document_type: z.enum(["invoice", "credit_note"]),
  prefix: seriesPrefix,
  start_number: wholeNumber("Starting number", 1, 999_999),
  /** Turn off the outlet's current series of this type first (only one can be active). */
  replace_current: z.boolean(),
});
export const seriesPrefixSchema = z.object({ id: uuid, prefix: seriesPrefix });
export const seriesNumberSchema = z.object({ id: uuid, next_number: wholeNumber("Next number", 1, 9_999_999_999) });
export const activeToggleSchema = z.object({ id: uuid, is_active: z.boolean() });
export const idSchema = z.object({ id: uuid });

export const deviceRenameSchema = z.object({ id: uuid, name: requiredText("Device name", 60) });

export const TRACKING_PLACEHOLDER = "{awb}";

export const courierSchema = z.object({
  id: uuidOptional,
  name: requiredText("Courier name", 80),
  tracking_url_template: z
    .string()
    .trim()
    .max(500, "Too long")
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https?:\/\//i.test(v), "The tracking link must start with http:// or https://")
    .refine((v) => v === null || v.includes(TRACKING_PLACEHOLDER), "Put {awb} where the tracking number goes")
    // The database check is case sensitive on the scheme.
    .transform((v) => (v === null ? null : v.replace(/^https?/i, (m) => m.toLowerCase()))),
  is_active: z.boolean(),
});

export const notificationPrefsSchema = z.object({
  notify_email_enabled: z.boolean(),
  notify_whatsapp_enabled: z.boolean(),
});

export type InvoicePrefsInput = z.input<typeof invoicePrefsFormSchema>;
export type CourierInput = z.input<typeof courierSchema>;
