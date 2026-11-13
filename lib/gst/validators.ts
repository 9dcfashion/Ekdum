/** PAN: 5 letters, 4 digits, 1 letter. */
export function isValidPan(input: string | null | undefined): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((input ?? "").trim().toUpperCase());
}

/** IFSC: 4 letters (bank), a literal 0, then 6 alphanumerics (branch). */
export function isValidIfsc(input: string | null | undefined): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test((input ?? "").trim().toUpperCase());
}

/** Indian PIN code: 6 digits, first digit 1–9. */
export function isValidPincode(input: string | null | undefined): boolean {
  return /^[1-9][0-9]{5}$/.test((input ?? "").trim());
}

/**
 * Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Accepts "98765 43210", "09876543210", "+91-9876543210", "919876543210".
 * Returns null when it is not a valid 10-digit mobile starting with 6–9.
 */
export function normaliseMobile(input: string | null | undefined): string | null {
  let digits = (input ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9][0-9]{9}$/.test(digits) ? `+91${digits}` : null;
}

export function isValidMobile(input: string | null | undefined): boolean {
  return normaliseMobile(input) !== null;
}

/** "+919876543210" → "98765 43210" for display. */
export function formatMobile(e164: string | null | undefined): string {
  const n = normaliseMobile(e164);
  if (!n) return e164 ?? "";
  return `${n.slice(3, 8)} ${n.slice(8)}`;
}

/** UPI VPA, e.g. "shopname@okhdfcbank". */
export function isValidUpiId(input: string | null | undefined): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test((input ?? "").trim());
}

/** HSN / SAC: 4, 6 or 8 digits. */
export function isValidHsn(input: string | null | undefined): boolean {
  return /^(\d{4}|\d{6}|\d{8})$/.test((input ?? "").trim());
}

/** Trim an HSN code to the number of digits the business prints (4 or 6). */
export function displayHsn(hsn: string | null | undefined, digits: 4 | 6 | 8 = 4): string {
  const code = (hsn ?? "").trim();
  return code.length > digits ? code.slice(0, digits) : code;
}

/** Show only the last 4 digits of a bank account number. */
export function maskAccountNumber(account: string | null | undefined): string {
  const a = (account ?? "").replace(/\s/g, "");
  if (a.length <= 4) return a;
  return `${"•".repeat(Math.min(a.length - 4, 8))}${a.slice(-4)}`;
}
