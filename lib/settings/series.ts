import { financialYear } from "@/lib/dates";
import { formatInvoiceNumber, normalisePrefix, validateSeriesPrefix } from "@/lib/gst/numbering";

/** Same rule the onboarding wizard uses: "A" → "ACN", "MUM" → "CMUM". */
export function deriveCreditNotePrefix(invoicePrefix: string): string {
  const p = normalisePrefix(invoicePrefix);
  return p.length <= 2 ? `${p}CN` : `C${p}`.slice(0, 4);
}

function isFree(prefix: string, used: ReadonlySet<string>): boolean {
  return !used.has(prefix) && validateSeriesPrefix(prefix) === null;
}

/**
 * The credit-note prefix for a new invoice series: the derived one when it is
 * free, otherwise the first free fallback (CN1, CN2, …). Null when nothing fits.
 */
export function creditNotePrefixFor(invoicePrefix: string, usedPrefixes: Iterable<string>): string | null {
  const invoice = normalisePrefix(invoicePrefix);
  const used = new Set([...usedPrefixes].map(normalisePrefix));
  used.add(invoice);
  const candidates = [deriveCreditNotePrefix(invoice), `C${invoice}`.slice(0, 3), "CN"];
  for (let i = 1; i <= 99; i++) candidates.push(`CN${i}`);
  return candidates.find((c) => isFree(c, used)) ?? null;
}

/** An unused invoice prefix to offer by default: A … Z, then A1 … Z9. */
export function suggestInvoicePrefix(usedPrefixes: Iterable<string>): string {
  const used = new Set([...usedPrefixes].map(normalisePrefix));
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const candidates = [...letters];
  for (let d = 1; d <= 9; d++) for (const l of letters) candidates.push(`${l}${d}`);
  return (
    candidates.find((c) => isFree(c, used) && isFree(deriveCreditNotePrefix(c), new Set([...used, c]))) ??
    candidates.find((c) => isFree(c, used)) ??
    ""
  );
}

/** "A/2627/00042", or null when the prefix is not valid or the number would pass 16 characters. */
export function sampleNumber(prefix: string, fy: string = financialYear(), sequence = 1): string | null {
  if (validateSeriesPrefix(prefix)) return null;
  try {
    return formatInvoiceNumber(prefix, fy, sequence);
  } catch {
    return null;
  }
}
