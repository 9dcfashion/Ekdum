import Decimal from "decimal.js";

/**
 * Money is always an integer number of paise (1 rupee = 100 paise).
 * JS numbers hold integers exactly up to 2^53, i.e. ~₹90 lakh crore, so a
 * plain `number` is safe as long as we never do fractional math on it.
 * All fractional math goes through decimal.js and is rounded half-up.
 */
export type Paise = number;

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Round a decimal amount of paise to a whole paisa, half-up (away from zero for negatives). */
export function roundPaise(value: Decimal.Value): Paise {
  const d = new Decimal(value);
  const rounded = d.isNegative()
    ? d.abs().toDecimalPlaces(0, Decimal.ROUND_HALF_UP).negated()
    : d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return rounded.toNumber();
}

/** "1,234.50" | "1234.5" | 1234.5 → 123450. Returns null when the input is not a number. */
export function rupeesToPaise(input: string | number | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;
  const cleaned = typeof input === "number" ? String(input) : input.replace(/[₹,\s]/g, "");
  if (cleaned === "" || !/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === "-" || cleaned === ".") {
    return null;
  }
  return roundPaise(new Decimal(cleaned).times(100));
}

/** 123450 → "1234.50" (plain, no grouping; safe for inputs and CSV). */
export function paiseToRupees(paise: Paise): string {
  return new Decimal(paise).dividedBy(100).toFixed(2);
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plainFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 12345600 → "₹1,23,456.00" (Indian digit grouping). */
export function formatINR(paise: Paise | null | undefined, opts: { symbol?: boolean } = {}): string {
  const value = new Decimal(paise ?? 0).dividedBy(100).toNumber();
  return opts.symbol === false ? plainFormatter.format(value) : inrFormatter.format(value);
}

const qtyFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** Quantities carry up to 3 decimals; trailing zeros are dropped. */
export function formatQty(qty: string | number | null | undefined): string {
  if (qty === null || qty === undefined || qty === "") return "0";
  return qtyFormatter.format(Number(qty));
}

/** Sum a list of paise values. */
export function sumPaise(values: Paise[]): Paise {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Split `total` across `weights` proportionally, in whole paise, so that the
 * parts always add up to exactly `total` (largest-remainder method).
 */
export function allocateProportionally(total: Paise, weights: Paise[]): Paise[] {
  const weightSum = weights.reduce((a, b) => a + Math.max(b, 0), 0);
  if (total === 0 || weightSum === 0) return weights.map(() => 0);

  const exact = weights.map((w) => new Decimal(Math.max(w, 0)).times(total).dividedBy(weightSum));
  const floors = exact.map((e) => e.floor().toNumber());
  let remainder = total - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((e, i) => ({ i, frac: e.minus(floors[i]) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);

  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}
