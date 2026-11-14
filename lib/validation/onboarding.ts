import { z } from "zod";
import { GST_SCHEMES, validateGstin, validateSeriesPrefix } from "@/lib/gst";
import {
  addressFields,
  emailOptional,
  hexColor,
  hsnOptional,
  ifscOptional,
  optionalText,
  panOptional,
  percentRequired,
  phoneLooseOptional,
  quantityOptional,
  requiredText,
  rupeesRequired,
  stateCodeRequired,
  upiOptional,
} from "./common";

export const TOTAL_STEPS = 7;

export const businessDetailsSchema = z
  .object({
    legal_name: requiredText("Legal name", 150),
    trade_name: optionalText(150),
    gst_scheme: z.enum(GST_SCHEMES),
    gstin: z.string().nullish(),
    pan: panOptional,
    state_code: stateCodeRequired,
    ...addressFields,
    phone: phoneLooseOptional,
    email: emailOptional,
  })
  .transform((v, ctx) => {
    if (v.gst_scheme === "unregistered") return { ...v, gstin: null };
    const parsed = validateGstin(v.gstin);
    if (!parsed.valid) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: parsed.message ?? "Enter a valid GSTIN" });
      return z.NEVER;
    }
    if (parsed.stateCode !== v.state_code) {
      ctx.addIssue({ code: "custom", path: ["state_code"], message: "The state must match the first two digits of the GSTIN" });
      return z.NEVER;
    }
    if (v.pan && v.pan !== parsed.pan) {
      ctx.addIssue({ code: "custom", path: ["pan"], message: "PAN does not match the GSTIN" });
      return z.NEVER;
    }
    return { ...v, gstin: parsed.gstin, pan: v.pan ?? parsed.pan ?? null };
  });

/** The line under the shop name on the bill, e.g. "Wholesale Dealer in: Fancy Jewellery". */
export const invoiceTagline = optionalText(120);

/** Common titles for the person who signs bills. Anything else can be typed in. */
export const SIGNATORY_TITLES = ["Proprietor", "Partner", "Director", "Authorised Signatory", "Manager"] as const;

/** The title printed under "For {shop}" on the bill. */
export const signatoryLabel = requiredText("Signature title", 40);

export const brandingSchema = z.object({
  logo_path: z.string().max(300).nullish().transform((v) => v || null),
  brand_color: hexColor,
  invoice_tagline: invoiceTagline,
});

export const paymentDetailsSchema = z.object({
  bank_name: optionalText(100),
  bank_account_name: optionalText(100),
  bank_account_number: z
    .string()
    .nullish()
    .transform((v) => (v && v.trim() ? v.replace(/\s/g, "") : null))
    .refine((v) => v === null || /^[0-9]{9,18}$/.test(v), "Account number should be 9 to 18 digits"),
  ifsc: ifscOptional,
  upi_id: upiOptional,
});

export const outletSchema = z
  .object({
    name: requiredText("Outlet name", 100),
    ...addressFields,
    state_code: stateCodeRequired,
    phone: phoneLooseOptional,
    /** Only for an outlet registered under a different GSTIN (another state). */
    gstin: z.string().nullish(),
  })
  .transform((v, ctx) => {
    if (!v.gstin || !v.gstin.trim()) return { ...v, gstin: null };
    const parsed = validateGstin(v.gstin);
    if (!parsed.valid) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: parsed.message ?? "Enter a valid GSTIN" });
      return z.NEVER;
    }
    if (parsed.stateCode !== v.state_code) {
      ctx.addIssue({ code: "custom", path: ["state_code"], message: "The state must match the outlet's GSTIN" });
      return z.NEVER;
    }
    return { ...v, gstin: parsed.gstin };
  });

export const seriesPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((v, ctx) => {
    const error = validateSeriesPrefix(v);
    if (error) ctx.addIssue({ code: "custom", message: error });
  });

export const invoiceSettingsSchema = z.object({
  prefix: seriesPrefix,
  start_number: z.coerce.number().int("Enter a whole number").min(1, "Must be 1 or more").max(999_999, "Too large").default(1),
  default_print_format: z.enum(["a4", "thermal_80", "thermal_58"]),
  round_off_enabled: z.boolean(),
  invoice_terms: optionalText(1000),
  invoice_footer: optionalText(300),
  signatory_label: signatoryLabel,
});

export const quickProductSchema = z.object({
  name: requiredText("Product name", 150),
  sale_price: rupeesRequired("Selling price"),
  price_includes_tax: z.boolean(),
  gst_rate: percentRequired,
  unit_code: requiredText("Unit", 4),
  hsn_code: hsnOptional,
  opening_stock: quantityOptional,
});

export type BusinessDetailsInput = z.input<typeof businessDetailsSchema>;
export type BrandingInput = z.input<typeof brandingSchema>;
export type PaymentDetailsInput = z.input<typeof paymentDetailsSchema>;
export type OutletInput = z.input<typeof outletSchema>;
export type InvoiceSettingsInput = z.input<typeof invoiceSettingsSchema>;
export type QuickProductInput = z.input<typeof quickProductSchema>;
