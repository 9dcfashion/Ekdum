import { Decimal } from "@/lib/money";
import type { MovementType } from "@/lib/types/db";

/** Pure helpers for the stock pages. Quantities have up to 3 decimals, so all maths is decimal.js. */

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  opening: "Opening stock",
  purchase: "Purchase",
  sale: "Sale",
  sale_return: "Sale return",
  adjustment: "Adjustment",
  sale_cancel: "Sale cancelled",
  purchase_cancel: "Purchase cancelled",
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type as MovementType] ?? type;
}

export const ADJUSTMENT_REASONS = ["damage", "theft", "recount", "other"] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  damage: "Damage",
  theft: "Theft or loss",
  recount: "Recount",
  other: "Other",
};

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return ADJUSTMENT_REASON_LABELS[reason as AdjustmentReason] ?? reason;
}

type Qty = string | number;

/** Sum of quantity deltas, as a plain decimal string ("12.5"). */
export function sumQuantities(deltas: Qty[]): string {
  return deltas.reduce<Decimal>((acc, d) => acc.plus(d), new Decimal(0)).toString();
}

/**
 * Balance after each movement, for a ledger listed NEWEST FIRST.
 * The newest row shows the total of every movement; each older row shows the
 * total without the movements above it. Index i of the result belongs to deltas[i].
 */
export function runningBalances(deltasNewestFirst: Qty[]): string[] {
  let balance = new Decimal(sumQuantities(deltasNewestFirst));
  return deltasNewestFirst.map((delta) => {
    const after = balance;
    balance = balance.minus(delta);
    return after.toString();
  });
}

/** The ledger must add up to the stored stock level. `difference` = ledger − level. */
export function ledgerCheck(deltas: Qty[], stockLevel: Qty | null | undefined): { ledgerTotal: string; stockLevel: string; matches: boolean; difference: string } {
  const total = new Decimal(sumQuantities(deltas));
  const level = new Decimal(stockLevel ?? 0);
  return {
    ledgerTotal: total.toString(),
    stockLevel: level.toString(),
    matches: total.equals(level),
    difference: total.minus(level).toString(),
  };
}

export type StockStatus = "negative" | "out" | "low" | "ok";

/** Low means at or below the product's threshold (the same rule as the dashboard). */
export function stockStatus(quantity: Qty | null | undefined, threshold: Qty | null | undefined): StockStatus {
  const q = new Decimal(quantity ?? 0);
  if (q.isNegative()) return "negative";
  if (q.isZero()) return "out";
  if (threshold !== null && threshold !== undefined && q.lessThanOrEqualTo(threshold)) return "low";
  return "ok";
}

/** True for anything the low-stock list should show: at or below its threshold. */
export function isLowStock(quantity: Qty | null | undefined, threshold: Qty | null | undefined): boolean {
  if (threshold === null || threshold === undefined) return false;
  return new Decimal(quantity ?? 0).lessThanOrEqualTo(threshold);
}

/** quantity − threshold. The most negative is the furthest below its threshold. */
export function belowThresholdBy(quantity: Qty | null | undefined, threshold: Qty): number {
  return new Decimal(quantity ?? 0).minus(threshold).toNumber();
}

export class AdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdjustmentError";
  }
}

/**
 * The signed delta to send to `adjust_stock`.
 *  - "set":    the user counted `quantity` on the shelf → delta = counted − current.
 *  - "change": add or remove `quantity`.
 */
export function adjustmentDelta(args: {
  mode: "set" | "change";
  quantity: Qty;
  direction?: "add" | "remove";
  current: Qty | null | undefined;
}): string {
  let qty: Decimal;
  try {
    qty = new Decimal(args.quantity);
  } catch {
    throw new AdjustmentError("Enter a valid quantity");
  }
  if (!qty.isFinite() || qty.isNegative() || qty.decimalPlaces() > 3) {
    throw new AdjustmentError("Enter a valid quantity (up to 3 decimals)");
  }
  let delta: Decimal;
  if (args.mode === "set") {
    delta = qty.minus(args.current ?? 0);
    if (delta.isZero()) throw new AdjustmentError("The counted quantity is the same as the current stock");
  } else {
    if (qty.isZero()) throw new AdjustmentError("Enter a quantity greater than zero");
    delta = args.direction === "remove" ? qty.negated() : qty;
  }
  return delta.toDecimalPlaces(3).toString();
}

/** "+5" / "-2.5" for display. */
export function signedQty(delta: Qty): string {
  const d = new Decimal(delta);
  const text = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(d.abs().toNumber());
  return `${d.isNegative() ? "-" : "+"}${text}`;
}

/**
 * Where a movement came from. Credit notes live on their invoice's page, so the
 * caller passes a map of credit note id → invoice id.
 */
export function movementSource(
  movement: { source_table: string | null; source_id: string | null },
  creditNoteInvoices: Record<string, string> = {},
): { href: string; label: string } | null {
  if (!movement.source_id) return null;
  switch (movement.source_table) {
    case "sales_invoices":
      return { href: `/app/sales/${movement.source_id}`, label: "Sale bill" };
    case "purchase_bills":
      return { href: `/app/purchases/${movement.source_id}`, label: "Purchase bill" };
    case "credit_notes": {
      const invoiceId = creditNoteInvoices[movement.source_id];
      return invoiceId ? { href: `/app/sales/${invoiceId}`, label: "Credit note" } : null;
    }
    default:
      return null;
  }
}
