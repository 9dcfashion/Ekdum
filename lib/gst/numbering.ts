/**
 * Invoice numbering (CGST Rule 46(b)): consecutive, unique per financial year,
 * at most 16 characters, only letters, digits, "-" and "/".
 * Format: {PREFIX}/{FY}/{SEQ}, e.g. C1/2627/00042.
 */
export const INVOICE_NUMBER_MAX_LENGTH = 16;
export const SERIES_PREFIX_MAX_LENGTH = 4;
export const SEQUENCE_MIN_DIGITS = 5;

const NUMBER_CHARS = /^[A-Z0-9/-]+$/;
const PREFIX_CHARS = /^[A-Z0-9-]+$/;

export function normalisePrefix(prefix: string): string {
  return prefix.trim().toUpperCase();
}

/** Returns an error message, or null when the prefix is usable. */
export function validateSeriesPrefix(input: string): string | null {
  const prefix = normalisePrefix(input);
  if (!prefix) return "Prefix is required";
  if (prefix.length > SERIES_PREFIX_MAX_LENGTH) {
    return `Prefix can be at most ${SERIES_PREFIX_MAX_LENGTH} characters`;
  }
  if (!PREFIX_CHARS.test(prefix)) return "Use only letters A–Z, digits 0–9 and hyphen";
  if (prefix.startsWith("-") || prefix.endsWith("-")) return "Prefix cannot start or end with a hyphen";
  return null;
}

export function formatInvoiceNumber(prefix: string, fy: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Sequence must be a positive integer");
  if (!/^\d{4}$/.test(fy)) throw new Error("Financial year must be 4 digits, e.g. 2627");
  const number = `${normalisePrefix(prefix)}/${fy}/${String(sequence).padStart(SEQUENCE_MIN_DIGITS, "0")}`;
  if (number.length > INVOICE_NUMBER_MAX_LENGTH) {
    throw new Error(`Invoice number ${number} is longer than ${INVOICE_NUMBER_MAX_LENGTH} characters`);
  }
  if (!NUMBER_CHARS.test(number)) throw new Error(`Invoice number ${number} contains characters that are not allowed`);
  return number;
}

export interface ParsedInvoiceNumber {
  prefix: string;
  fy: string;
  sequence: number;
}

export function parseInvoiceNumber(number: string): ParsedInvoiceNumber | null {
  if (number.length > INVOICE_NUMBER_MAX_LENGTH) return null;
  const match = /^([A-Z0-9-]{1,4})\/(\d{4})\/(\d{5,})$/.exec(number);
  if (!match) return null;
  const sequence = Number(match[3]);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { prefix: match[1], fy: match[2], sequence };
}

/** The largest sequence a prefix can reach before the number exceeds 16 characters. */
export function maxSequenceForPrefix(prefix: string): number {
  const digits = INVOICE_NUMBER_MAX_LENGTH - normalisePrefix(prefix).length - 1 - 4 - 1;
  return Number("9".repeat(Math.min(digits, 15)));
}
