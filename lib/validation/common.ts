import { z } from "zod";
import {
  isValidGstin,
  isValidIfsc,
  isValidPan,
  isValidPincode,
  isValidStateCode,
  isValidUpiId,
  normaliseGstin,
  normaliseMobile,
  isValidHsn,
} from "@/lib/gst";
import { rupeesToPaise } from "@/lib/money";

/**
 * Field schemas shared by client forms and Server Actions.
 * Forms submit plain strings; these trim, normalise and validate them.
 * Optional fields accept "" and turn it into null.
 */

const trimmed = z.string().trim();

export const requiredText = (label: string, max = 200) =>
  trimmed.min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .nullish()
    .transform((v) => (v ? v : null));

export const gstinRequired = trimmed
  .transform(normaliseGstin)
  .refine(isValidGstin, "Enter a valid 15-character GSTIN");

export const gstinOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? normaliseGstin(v) : null))
  .refine((v) => v === null || isValidGstin(v), "Enter a valid 15-character GSTIN");

export const panOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim().toUpperCase() : null))
  .refine((v) => v === null || isValidPan(v), "Enter a valid PAN (e.g. ABCDE1234F)");

export const ifscOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim().toUpperCase() : null))
  .refine((v) => v === null || isValidIfsc(v), "Enter a valid IFSC (e.g. HDFC0001234)");

export const upiOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || isValidUpiId(v), "Enter a valid UPI ID (e.g. shop@okhdfcbank)");

export const pincodeOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || isValidPincode(v), "Enter a valid 6-digit PIN code");

export const stateCodeRequired = trimmed.refine(isValidStateCode, "Select a state");

export const stateCodeOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || isValidStateCode(v), "Select a state");

/** Indian mobile → +91XXXXXXXXXX. */
export const mobileRequired = trimmed
  .transform((v, ctx) => {
    const n = normaliseMobile(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
      return z.NEVER;
    }
    return n;
  });

export const mobileOptional = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const n = normaliseMobile(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid 10-digit mobile number" });
      return z.NEVER;
    }
    return n;
  });

/** Landline or mobile for a business card: digits, spaces, +, -. */
export const phoneLooseOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || /^[0-9+\-\s()]{6,20}$/.test(v), "Enter a valid phone number");

export const emailRequired = trimmed.toLowerCase().pipe(z.email("Enter a valid email address"));

export const emailOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim().toLowerCase() : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email address");

export const hsnOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || isValidHsn(v), "HSN must be 4, 6 or 8 digits");

/** A rupee amount typed by the user ("1,234.50") → integer paise. */
export const rupeesRequired = (label = "Amount") =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const paise = rupeesToPaise(v);
    if (paise === null || paise < 0) {
      ctx.addIssue({ code: "custom", message: `${label} must be a valid amount` });
      return z.NEVER;
    }
    return paise;
  });

export const rupeesOptional = (label = "Amount") =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const paise = rupeesToPaise(v);
      if (paise === null || paise < 0) {
        ctx.addIssue({ code: "custom", message: `${label} must be a valid amount` });
        return z.NEVER;
      }
      return paise;
    });

/** Quantity with up to 3 decimals, as a string to avoid float drift. */
export const quantityRequired = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(s) || Number(s) <= 0) {
    ctx.addIssue({ code: "custom", message: "Enter a quantity greater than zero (up to 3 decimals)" });
    return z.NEVER;
  }
  return s;
});

export const quantityOptional = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v, ctx) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const s = String(v).trim();
    if (!/^\d+(\.\d{1,3})?$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid quantity (up to 3 decimals)" });
      return z.NEVER;
    }
    return s;
  });

export const percentRequired = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = Number(v);
  if (String(v).trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) {
    ctx.addIssue({ code: "custom", message: "Enter a percentage between 0 and 100" });
    return z.NEVER;
  }
  return Math.round(n * 100) / 100;
});

export const uuid = z.uuid("Invalid id");
export const uuidOptional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Invalid id");

export const isoDate = trimmed.regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
export const hexColor = trimmed.regex(/^#[0-9A-Fa-f]{6}$/, "Pick a colour");

/** Address block reused by businesses, outlets, customers and vendors. */
export const addressFields = {
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  pincode: pincodeOptional,
};
