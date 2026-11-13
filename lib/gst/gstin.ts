import { isValidStateCode } from "./states";

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Uppercase and strip spaces so "27 aapfu0939f 1zv" validates. */
export function normaliseGstin(input: string | null | undefined): string {
  return (input ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * Check character for the first 14 characters of a GSTIN (mod-36 Luhn-style):
 * each character's base-36 value is multiplied by 1, 2, 1, 2 …; the quotient
 * and remainder of that product by 36 are summed; check = (36 − sum mod 36) mod 36.
 */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    if (value < 0) throw new Error("Invalid character in GSTIN");
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export type GstinError = "length" | "format" | "state" | "checksum";

export interface GstinResult {
  valid: boolean;
  gstin: string;
  error?: GstinError;
  message?: string;
  stateCode?: string;
  pan?: string;
}

const MESSAGES: Record<GstinError, string> = {
  length: "GSTIN must be exactly 15 characters",
  format: "GSTIN format is not valid",
  state: "GSTIN starts with an unknown state code",
  checksum: "GSTIN check digit does not match. Please re-check for typos",
};

export function validateGstin(input: string | null | undefined): GstinResult {
  const gstin = normaliseGstin(input);
  const fail = (error: GstinError): GstinResult => ({ valid: false, gstin, error, message: MESSAGES[error] });

  if (gstin.length !== 15) return fail("length");
  if (!GSTIN_FORMAT.test(gstin)) return fail("format");
  const stateCode = gstin.slice(0, 2);
  if (!isValidStateCode(stateCode)) return fail("state");
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return fail("checksum");

  return { valid: true, gstin, stateCode, pan: gstin.slice(2, 12) };
}

export function isValidGstin(input: string | null | undefined): boolean {
  return validateGstin(input).valid;
}
