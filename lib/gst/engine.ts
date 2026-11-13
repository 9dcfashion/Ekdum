import { Decimal, allocateProportionally, roundPaise, type Paise } from "@/lib/money";

/**
 * The GST calculation engine. Pure functions only: the POS uses them for live
 * totals, the server re-runs them before posting, and the offline queue uses
 * them with no network. All money is integer paise; intermediate math is
 * decimal.js rounded half-up to the paisa.
 */

export interface LineInput {
  /** Up to 3 decimal places. */
  quantity: string | number;
  unitPricePaise: Paise;
  /** True for MRP-style prices that already contain GST. */
  priceIncludesTax: boolean;
  /** Line discount as an amount in paise (resolve percentages with `percentOf` first). */
  discountPaise?: Paise;
  /** GST rate in percent, e.g. 18 or "0.25". */
  gstRate: string | number;
  /** Compensation cess rate in percent on the taxable value. Default 0. */
  cessRate?: string | number;
}

export interface InvoiceCalcInput {
  lines: LineInput[];
  /** Bill-level discount, spread across lines in proportion to their value before tax. */
  billDiscountPaise?: Paise;
  /** False for composition and unregistered sellers: no tax is charged on any line. */
  chargeTax: boolean;
  /** True → IGST. False → CGST + SGST. */
  isInterState: boolean;
  /** Round the grand total to the nearest rupee. */
  roundOff: boolean;
}

export interface LineResult {
  /** quantity × unit price, before any discount. */
  grossPaise: Paise;
  lineDiscountPaise: Paise;
  billDiscountPaise: Paise;
  /** lineDiscountPaise + billDiscountPaise. */
  discountPaise: Paise;
  taxablePaise: Paise;
  gstRate: string;
  cessRate: string;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  /** taxablePaise + all taxes. */
  totalPaise: Paise;
}

export interface InvoiceTotals {
  lines: LineResult[];
  /** Sum of line gross values (before discounts; includes tax for tax-inclusive prices). */
  subtotalPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  /** cgst + sgst + igst + cess. */
  taxPaise: Paise;
  roundOffPaise: Paise;
  /** Grand total payable, after round-off. */
  totalPaise: Paise;
}

export class GstEngineError extends Error {
  constructor(
    message: string,
    public readonly lineIndex?: number,
  ) {
    super(message);
    this.name = "GstEngineError";
  }
}

function rate(value: string | number | undefined, label: string, lineIndex: number): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(value ?? 0);
  } catch {
    throw new GstEngineError(`${label} is not a number`, lineIndex);
  }
  if (!d.isFinite() || d.isNegative() || d.greaterThan(100)) {
    throw new GstEngineError(`${label} must be between 0 and 100`, lineIndex);
  }
  return d;
}

/** quantity × unit price, rounded to the paisa. */
export function lineGross(quantity: string | number, unitPricePaise: Paise): Paise {
  return roundPaise(new Decimal(quantity).times(unitPricePaise));
}

/** `percent`% of `amountPaise`, rounded to the paisa. */
export function percentOf(amountPaise: Paise, percent: string | number): Paise {
  return roundPaise(new Decimal(amountPaise).times(percent).dividedBy(100));
}

/** Discount as a percentage of the pre-discount subtotal (0 when there is nothing to discount). */
export function discountPercent(discountPaise: Paise, subtotalPaise: Paise): number {
  if (subtotalPaise <= 0) return 0;
  return new Decimal(discountPaise).times(100).dividedBy(subtotalPaise).toDecimalPlaces(2).toNumber();
}

/** Intra-state split: CGST takes the floor, SGST the rest, so an odd paisa is never lost. */
export function splitIntraState(taxPaise: Paise): { cgstPaise: Paise; sgstPaise: Paise } {
  const cgstPaise = Math.floor(taxPaise / 2);
  return { cgstPaise, sgstPaise: taxPaise - cgstPaise };
}

/** Round a total to the nearest rupee (half-up) and return the adjustment. */
export function roundOffToRupee(totalPaise: Paise): { roundedPaise: Paise; roundOffPaise: Paise } {
  const roundedPaise = roundPaise(new Decimal(totalPaise).dividedBy(100)) * 100;
  return { roundedPaise, roundOffPaise: roundedPaise - totalPaise };
}

export function computeInvoice(input: InvoiceCalcInput): InvoiceTotals {
  const billDiscount = input.billDiscountPaise ?? 0;
  if (!Number.isInteger(billDiscount) || billDiscount < 0) {
    throw new GstEngineError("Bill discount must be a non-negative whole number of paise");
  }

  // Pass 1: gross and line discounts.
  const staged = input.lines.map((line, index) => {
    let qty: Decimal;
    try {
      qty = new Decimal(line.quantity);
    } catch {
      throw new GstEngineError("Quantity is not a number", index);
    }
    if (!qty.isFinite() || qty.lessThanOrEqualTo(0)) {
      throw new GstEngineError("Quantity must be greater than zero", index);
    }
    if (qty.decimalPlaces() > 3) {
      throw new GstEngineError("Quantity can have at most 3 decimal places", index);
    }
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      throw new GstEngineError("Unit price must be a non-negative whole number of paise", index);
    }
    const lineDiscountPaise = line.discountPaise ?? 0;
    if (!Number.isInteger(lineDiscountPaise) || lineDiscountPaise < 0) {
      throw new GstEngineError("Discount must be a non-negative whole number of paise", index);
    }
    const grossPaise = lineGross(line.quantity, line.unitPricePaise);
    if (lineDiscountPaise > grossPaise) {
      throw new GstEngineError("Discount cannot be more than the line amount", index);
    }
    return {
      line,
      grossPaise,
      lineDiscountPaise,
      netBeforeBillDiscount: grossPaise - lineDiscountPaise,
      gstRate: input.chargeTax ? rate(line.gstRate, "GST rate", index) : new Decimal(0),
      cessRate: input.chargeTax ? rate(line.cessRate, "Cess rate", index) : new Decimal(0),
    };
  });

  // Pass 2: spread the bill discount in proportion to each line's value before tax.
  const netTotal = staged.reduce((sum, s) => sum + s.netBeforeBillDiscount, 0);
  if (billDiscount > netTotal) {
    throw new GstEngineError("Bill discount cannot be more than the bill amount");
  }
  const billShares = allocateProportionally(
    billDiscount,
    staged.map((s) => s.netBeforeBillDiscount),
  );

  // Pass 3: tax per line.
  const lines: LineResult[] = staged.map((s, i) => {
    const billDiscountPaise = billShares[i];
    const net = s.netBeforeBillDiscount - billDiscountPaise;
    const hundred = new Decimal(100);

    let taxablePaise: Paise;
    let gstPaise: Paise;
    let cessPaise: Paise;

    if (s.line.priceIncludesTax) {
      // net already contains GST (+ cess). Back the tax out so taxable + tax = net exactly.
      const combinedRate = s.gstRate.plus(s.cessRate);
      const combinedTax = roundPaise(
        new Decimal(net).minus(new Decimal(net).dividedBy(new Decimal(1).plus(combinedRate.dividedBy(hundred)))),
      );
      taxablePaise = net - combinedTax;
      if (s.cessRate.isZero()) {
        gstPaise = combinedTax;
        cessPaise = 0;
      } else {
        gstPaise = roundPaise(new Decimal(combinedTax).times(s.gstRate).dividedBy(combinedRate));
        cessPaise = combinedTax - gstPaise;
      }
    } else {
      taxablePaise = net;
      gstPaise = roundPaise(new Decimal(net).times(s.gstRate).dividedBy(hundred));
      cessPaise = roundPaise(new Decimal(net).times(s.cessRate).dividedBy(hundred));
    }

    const split = input.isInterState ? { cgstPaise: 0, sgstPaise: 0 } : splitIntraState(gstPaise);
    const igstPaise = input.isInterState ? gstPaise : 0;

    return {
      grossPaise: s.grossPaise,
      lineDiscountPaise: s.lineDiscountPaise,
      billDiscountPaise,
      discountPaise: s.lineDiscountPaise + billDiscountPaise,
      taxablePaise,
      gstRate: s.gstRate.toFixed(2),
      cessRate: s.cessRate.toFixed(2),
      cgstPaise: split.cgstPaise,
      sgstPaise: split.sgstPaise,
      igstPaise,
      cessPaise,
      totalPaise: taxablePaise + gstPaise + cessPaise,
    };
  });

  const sum = (pick: (l: LineResult) => Paise) => lines.reduce((acc, l) => acc + pick(l), 0);
  const taxablePaise = sum((l) => l.taxablePaise);
  const cgstPaise = sum((l) => l.cgstPaise);
  const sgstPaise = sum((l) => l.sgstPaise);
  const igstPaise = sum((l) => l.igstPaise);
  const cessPaise = sum((l) => l.cessPaise);
  const taxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const beforeRoundOff = taxablePaise + taxPaise;
  const { roundedPaise, roundOffPaise } = input.roundOff
    ? roundOffToRupee(beforeRoundOff)
    : { roundedPaise: beforeRoundOff, roundOffPaise: 0 };

  return {
    lines,
    subtotalPaise: sum((l) => l.grossPaise),
    discountPaise: sum((l) => l.discountPaise),
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    taxPaise,
    roundOffPaise,
    totalPaise: roundedPaise,
  };
}

const TOTAL_KEYS = [
  "subtotalPaise",
  "discountPaise",
  "taxablePaise",
  "cgstPaise",
  "sgstPaise",
  "igstPaise",
  "cessPaise",
  "roundOffPaise",
  "totalPaise",
] as const;

export type TotalsOnly = Pick<InvoiceTotals, (typeof TOTAL_KEYS)[number]>;

/** Field names where two sets of totals differ by more than `tolerancePaise`. */
export function diffTotals(a: TotalsOnly, b: TotalsOnly, tolerancePaise = 0): string[] {
  return TOTAL_KEYS.filter((k) => Math.abs(a[k] - b[k]) > tolerancePaise);
}

export interface RateSummaryRow {
  gstRate: string;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
}

/** Tax break-up grouped by GST rate, lowest rate first (printed under the totals). */
export function summariseByRate(
  lines: Array<Pick<LineResult, "gstRate" | "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "cessPaise">>,
): RateSummaryRow[] {
  const map = new Map<string, RateSummaryRow>();
  for (const l of lines) {
    const key = new Decimal(l.gstRate).toFixed(2);
    const row =
      map.get(key) ??
      ({ gstRate: key, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, cessPaise: 0 } as RateSummaryRow);
    row.taxablePaise += l.taxablePaise;
    row.cgstPaise += l.cgstPaise;
    row.sgstPaise += l.sgstPaise;
    row.igstPaise += l.igstPaise;
    row.cessPaise += l.cessPaise;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => Number(a.gstRate) - Number(b.gstRate));
}

/** "18.00" → "18%", "0.25" → "0.25%". */
export function formatRate(value: string | number): string {
  return `${new Decimal(value).toDecimalPlaces(2).toString()}%`;
}
