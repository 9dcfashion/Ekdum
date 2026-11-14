import { addDays } from "@/lib/dates";
import { Decimal, rupeesToPaise, type Paise } from "@/lib/money";
import { MAX_ROUND_OFF_PAISE } from "@/lib/validation/purchases";
import { liveTotals, type LooseLine } from "./compute";

/**
 * Pure rules behind the guided purchase entry (photo → supplier → items → save).
 * No React here, so every rule is unit tested in flow.test.ts.
 */

export type PurchaseStep = 1 | 2 | 3 | 4;

export const PURCHASE_STEPS: ReadonlyArray<{ step: PurchaseStep; label: string }> = [
  { step: 1, label: "Photo" },
  { step: 2, label: "Supplier" },
  { step: 3, label: "Items" },
  { step: 4, label: "Save" },
];

/** "?step=3" → 3. Anything else → null. */
export function parseStep(value: string | null | undefined): PurchaseStep | null {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

/** A bill line as it sits in the form: strings that may be half-typed. */
export interface FlowLine extends LooseLine {
  product_id?: string | null;
  description?: string | null;
}

/** The parts of the form the step rules look at. */
export interface FlowBill {
  id?: string | null;
  vendor_id?: string | null;
  vendor_invoice_number?: string | null;
  vendor_invoice_date?: string | null;
  attachment_paths?: readonly string[] | null;
  lines?: ReadonlyArray<FlowLine | undefined> | null;
}

const filled = (v: string | null | undefined) => !!v && v.trim() !== "";

/** A line is ready when it has a name and the GST engine can price it (valid qty, rate, discount, rates). */
export function isLineReady(line: FlowLine | undefined): boolean {
  if (!line || !filled(line.description)) return false;
  return liveTotals([line], false, 0).lines[0] !== null;
}

export interface StepCompleteness {
  photo: boolean;
  supplier: boolean;
  items: boolean;
}

export function stepCompleteness(bill: FlowBill): StepCompleteness {
  const lines = bill.lines ?? [];
  return {
    photo: (bill.attachment_paths ?? []).length > 0,
    supplier: filled(bill.vendor_id) && filled(bill.vendor_invoice_number) && filled(bill.vendor_invoice_date),
    items: lines.length > 0 && lines.every(isLineReady),
  };
}

/** Nothing entered yet and never saved. */
export function isBlankBill(bill: FlowBill): boolean {
  return (
    !filled(bill.id) &&
    (bill.attachment_paths ?? []).length === 0 &&
    !filled(bill.vendor_id) &&
    !filled(bill.vendor_invoice_number) &&
    !filled(bill.vendor_invoice_date) &&
    (bill.lines ?? []).length === 0
  );
}

/**
 * Where the flow opens. A new bill starts at the photo. A saved draft (or an AI
 * prefill) skips the optional photo step and opens at the first step that still
 * needs work, or at "Save" when everything is filled in.
 */
export function firstIncompleteStep(bill: FlowBill): PurchaseStep {
  if (isBlankBill(bill)) return 1;
  const done = stepCompleteness(bill);
  if (!done.supplier) return 2;
  if (!done.items) return 3;
  return 4;
}

/** True when the bill holds photos and nothing else: "save photo only" makes sense. */
export function isPhotoOnly(bill: FlowBill): boolean {
  return (
    (bill.attachment_paths ?? []).length > 0 &&
    !filled(bill.vendor_id) &&
    !filled(bill.vendor_invoice_number) &&
    !filled(bill.vendor_invoice_date) &&
    (bill.lines ?? []).length === 0
  );
}

export type SupplierField = "vendor_id" | "vendor_invoice_number" | "vendor_invoice_date";

/** What step 2 still needs, in plain words. Empty when the step is complete. */
export function supplierStepProblems(bill: FlowBill): Partial<Record<SupplierField, string>> {
  const problems: Partial<Record<SupplierField, string>> = {};
  if (!filled(bill.vendor_id)) problems.vendor_id = "Pick the supplier";
  if (!filled(bill.vendor_invoice_number)) problems.vendor_invoice_number = "Type the bill number from the paper";
  if (!filled(bill.vendor_invoice_date)) problems.vendor_invoice_date = "Pick the bill date";
  return problems;
}

const STEP_2_FIELDS = new Set(["vendor_id", "vendor_invoice_number", "vendor_invoice_date", "outlet_id", "is_inter_state"]);

/** Which step shows a form field, so an error from the server can take the user there. */
export function stepForField(path: string): PurchaseStep {
  const root = path.split(".")[0];
  if (root === "attachment_paths") return 1;
  if (STEP_2_FIELDS.has(root)) return 2;
  if (root === "lines") return 3;
  return 4;
}

/** The earliest step among a set of field paths (e.g. the keys of fieldErrors). */
export function firstStepWithError(paths: Iterable<string>): PurchaseStep | null {
  let first: PurchaseStep | null = null;
  for (const path of paths) {
    if (path === "_form") continue;
    const step = stepForField(path);
    if (first === null || step < first) first = step;
  }
  return first;
}

// ── "Total on the paper bill" ───────────────────────────────────────────────

/** Differences up to this much are treated as rounding on the supplier's side. */
export const PAPER_TOTAL_TOLERANCE_PAISE = 500;

export type PaperTotalCheck =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "match" }
  /** One tap fixes it: set the round-off to `roundOffPaise`. `differencePaise` > 0 means the paper says more. */
  | { kind: "round_off"; differencePaise: Paise; roundOffPaise: Paise }
  /** Close (within the tolerance) but more than a round-off may cover. */
  | { kind: "small"; differencePaise: Paise }
  /** Too far apart: something was typed wrong. */
  | { kind: "big"; differencePaise: Paise };

/**
 * Compare the total printed on the supplier's bill with ours.
 * `beforeRoundOffPaise` is our total without any round-off; `roundOffPaise` is the round-off in the form now.
 * A one-tap match is offered only while the needed round-off stays within what the server accepts.
 */
export function checkPaperTotal(args: {
  paperTotal: string | null | undefined;
  beforeRoundOffPaise: Paise;
  roundOffPaise: Paise;
  maxRoundOffPaise?: Paise;
  tolerancePaise?: Paise;
}): PaperTotalCheck {
  const { beforeRoundOffPaise, roundOffPaise } = args;
  const maxRoundOff = Math.min(args.maxRoundOffPaise ?? MAX_ROUND_OFF_PAISE, MAX_ROUND_OFF_PAISE);
  const tolerance = Math.max(args.tolerancePaise ?? PAPER_TOTAL_TOLERANCE_PAISE, maxRoundOff);
  const text = (args.paperTotal ?? "").trim();
  if (text === "") return { kind: "empty" };
  const paper = rupeesToPaise(text);
  if (paper === null || paper < 0) return { kind: "invalid" };

  const differencePaise = paper - (beforeRoundOffPaise + roundOffPaise);
  if (differencePaise === 0) return { kind: "match" };
  const needed = paper - beforeRoundOffPaise;
  if (Math.abs(needed) <= maxRoundOff) return { kind: "round_off", differencePaise, roundOffPaise: needed };
  if (Math.abs(needed) <= tolerance) return { kind: "small", differencePaise };
  return { kind: "big", differencePaise };
}

export type PaperTotalHint = "rates_include_gst" | "rates_exclude_gst";

/**
 * The most common reason a purchase total is far off: the rates on the paper
 * already include GST (or do not). Returns the switch that would bring our
 * total within the tolerance of the paper total, if there is one.
 */
export function paperTotalHint(
  lines: ReadonlyArray<FlowLine | undefined>,
  isInterState: boolean,
  paperTotalPaise: Paise,
  tolerancePaise: Paise = PAPER_TOTAL_TOLERANCE_PAISE,
): PaperTotalHint | null {
  const present = lines.filter((l): l is FlowLine => !!l);
  if (present.length === 0) return null;
  const close = (includes: boolean) => {
    const totals = liveTotals(
      present.map((l) => ({ ...l, price_includes_tax: includes })),
      isInterState,
      0,
    );
    return totals.incompleteLines === 0 && Math.abs(paperTotalPaise - totals.beforeRoundOffPaise) <= tolerancePaise;
  };
  if (present.some((l) => !l.price_includes_tax) && close(true)) return "rates_include_gst";
  if (present.some((l) => !!l.price_includes_tax) && close(false)) return "rates_exclude_gst";
  return null;
}

// ── Suppliers ───────────────────────────────────────────────────────────────

/**
 * Split suppliers into "recent" (most recent purchase first, no repeats) and
 * everyone else (A to Z). `recentIds` are vendor ids from the latest bills, newest first.
 */
export function orderVendorsByRecent<T extends { id: string; name: string }>(
  vendors: readonly T[],
  recentIds: ReadonlyArray<string | null | undefined>,
  limit = 5,
): { recent: T[]; others: T[] } {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const recent: T[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (recent.length >= limit) break;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const vendor = byId.get(id);
    if (vendor) recent.push(vendor);
  }
  const taken = new Set(recent.map((v) => v.id));
  const others = vendors.filter((v) => !taken.has(v.id)).sort((a, b) => a.name.localeCompare(b.name, "en-IN", { sensitivity: "base" }));
  return { recent, others };
}

/**
 * Search suppliers by name, GSTIN or phone. Names that start with the text come
 * first, then names with a word that starts with it, then any other match.
 */
export function filterVendors<T extends { name: string; gstin?: string | null; phone?: string | null }>(vendors: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...vendors];
  const digits = q.replace(/\D/g, "");
  const scored: Array<{ v: T; score: number; i: number }> = [];
  vendors.forEach((v, i) => {
    const name = v.name.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/[\s.,&()/-]+/).some((word) => word.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else if ((v.gstin ?? "").toLowerCase().includes(q)) score = 3;
    else if (digits.length >= 3 && (v.phone ?? "").replace(/\D/g, "").includes(digits)) score = 3;
    if (score >= 0) scored.push({ v, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.v);
}

// ── Items ───────────────────────────────────────────────────────────────────

/**
 * Products bought most recently, newest bill first and in bill order, without
 * repeats. `billIds` are newest first; `items` are lines from those bills.
 */
export function rankRecentProducts(
  billIds: readonly string[],
  items: ReadonlyArray<{ purchase_bill_id: string; product_id: string | null; line_no: number }>,
  limit = 12,
): string[] {
  const rank = new Map(billIds.map((id, i) => [id, i]));
  const sorted = items
    .filter((i) => !!i.product_id && rank.has(i.purchase_bill_id))
    .sort((a, b) => rank.get(a.purchase_bill_id)! - rank.get(b.purchase_bill_id)! || a.line_no - b.line_no);
  const ids: string[] = [];
  for (const item of sorted) {
    if (ids.length >= limit) break;
    if (!ids.includes(item.product_id!)) ids.push(item.product_id!);
  }
  return ids;
}

const QTY = /^\d+(\.\d{1,3})?$/;

/** The − / + buttons on an item. Never goes to zero or below; unreadable text becomes 1. */
export function stepQuantity(current: string | number | null | undefined, delta: 1 | -1): string {
  const text = String(current ?? "").trim();
  if (!QTY.test(text) || Number(text) <= 0) return "1";
  const next = new Decimal(text).plus(delta);
  return next.lte(0) ? new Decimal(text).toString() : next.toString();
}

export function canDecreaseQuantity(current: string | number | null | undefined): boolean {
  const text = String(current ?? "").trim();
  return QTY.test(text) && Number(text) > 1;
}

// ── Bill date ───────────────────────────────────────────────────────────────

export type DateChoice = "today" | "yesterday" | "other" | "none";

export function dateChoice(value: string | null | undefined, today: string): DateChoice {
  if (!value) return "none";
  if (value === today) return "today";
  if (value === addDays(today, -1)) return "yesterday";
  return "other";
}
