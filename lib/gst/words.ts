const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h && rest) return `${ONES[h]} Hundred ${twoDigits(rest)}`;
  if (h) return `${ONES[h]} Hundred`;
  return twoDigits(rest);
}

/** Whole number → words in the Indian system (thousand, lakh, crore). */
export function numberToIndianWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Expected a non-negative integer");
  if (value === 0) return "Zero";

  const crore = Math.floor(value / 1_00_00_000);
  const lakh = Math.floor((value % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((value % 1_00_000) / 1000);
  const rest = value % 1000;

  const parts: string[] = [];
  // Values above 99,99,999 crore recurse so "crore" can itself carry lakhs.
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/**
 * Amount in paise → the line printed on invoices, e.g.
 * 12345650 → "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only".
 */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error("Expected integer paise");
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  let words = `Rupees ${numberToIndianWords(rupees)}`;
  if (p) words += ` and ${twoDigits(p)} Paise`;
  return `${negative ? "Minus " : ""}${words} Only`;
}
