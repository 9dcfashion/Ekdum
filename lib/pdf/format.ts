/**
 * Text helpers for the PDF. The template uses the built-in Helvetica font
 * (no font files to ship), which only covers the WinAnsi character set:
 * there is no rupee sign and no Indic script. Everything printed goes
 * through these helpers so the PDF never contains a glyph the font cannot draw.
 */

/** 12345650 → "1,23,456.50" (Indian grouping, no currency symbol). Integer math only. */
export function pdfMoney(paise: number | null | undefined): string {
  const value = Math.round(paise ?? 0);
  const negative = value < 0;
  const abs = Math.abs(value);
  const rupees = Math.floor(abs / 100).toString();
  const fraction = (abs % 100).toString().padStart(2, "0");
  let grouped = rupees;
  if (rupees.length > 3) {
    const lastThree = rupees.slice(-3);
    const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${lastThree}`;
  }
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

/** "Rs. 1,23,456.50" */
export function pdfRupees(paise: number | null | undefined): string {
  return `Rs. ${pdfMoney(paise)}`;
}

/** Round-off is shown with its sign: "+0.40" / "-0.35" / "0.00". */
export function pdfSigned(paise: number): string {
  return paise > 0 ? `+${pdfMoney(paise)}` : pdfMoney(paise);
}

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/\u20B9\s?/g, "Rs. "],
  [/[\u2018\u2019\u201A\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u2022\u25CF\u25E6\u2219]/g, "\u00B7"],
  [/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " "],
  [/[\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g, ""],
  [/[\t\r]/g, " "],
];

/**
 * Makes a string safe for Helvetica: common typographic characters are mapped
 * to plain ones and anything else outside Latin-1 becomes "?".
 */
export function pdfText(value: string | null | undefined): string {
  let text = (value ?? "").normalize("NFC");
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  // Printable ASCII, newline, and the printable Latin-1 block are all in WinAnsi.
  return text.replace(/[^\n\x20-\x7E\xA1-\xFF]/g, "?");
}

/** Applies pdfText to every string in a plain object tree (the invoice view). */
export function pdfSafeDeep<T>(value: T): T {
  if (typeof value === "string") return pdfText(value) as T;
  if (Array.isArray(value)) return value.map((v) => pdfSafeDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = pdfSafeDeep(inner);
    return out as T;
  }
  return value;
}

/** "A/2627/00042" → "Invoice-A-2627-00042.pdf" */
export function invoicePdfFilename(invoiceNumber: string): string {
  const safe = invoiceNumber
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "")
    .replace(/^-+|-+$/g, "");
  return `Invoice-${safe || "bill"}.pdf`;
}
