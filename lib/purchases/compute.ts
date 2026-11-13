import {
  GstEngineError,
  computeInvoice,
  sellerStateCode,
  normaliseGstin,
  isValidStateCode,
  type InvoiceTotals,
  type LineInput,
  type LineResult,
} from "@/lib/gst";
import { rupeesToPaise, type Paise } from "@/lib/money";
import { MAX_ROUND_OFF_PAISE, type PurchaseBillData, type PurchaseLineData } from "@/lib/validation/purchases";

/**
 * Purchase bill maths. The same GST engine as sales (`computeInvoice`), with
 * two differences: tax is always computed (the vendor charged it), and the
 * round-off is typed by hand so the total can match the vendor's printed total.
 */

export class PurchaseComputeError extends Error {
  constructor(
    message: string,
    public readonly lineIndex?: number,
  ) {
    super(message);
    this.name = "PurchaseComputeError";
  }
}

export interface PurchaseSupply {
  /** Our state at the receiving outlet. This is the place of supply of a purchase. */
  ourState: string;
  /** The vendor's state (GSTIN first two digits, else their address state). Null when unknown. */
  vendorState: string | null;
  /** True → the vendor should have charged IGST. */
  isInterState: boolean;
}

/** Our state for tax purposes at an outlet: the outlet GSTIN (else the business GSTIN), else the outlet address. */
export function ourStateCode(
  outlet: { gstin?: string | null; state_code: string },
  businessGstin: string | null | undefined,
): string {
  return sellerStateCode({ gstin: outlet.gstin ?? businessGstin, state_code: outlet.state_code });
}

export function vendorStateCode(vendor: { gstin?: string | null; state_code?: string | null } | null | undefined): string | null {
  if (!vendor) return null;
  // The first two characters of a GSTIN are the state code, whatever the rest looks like.
  const prefix = normaliseGstin(vendor.gstin).slice(0, 2);
  if (/^\d{2}$/.test(prefix) && isValidStateCode(prefix)) return prefix;
  return isValidStateCode(vendor.state_code) ? vendor.state_code! : null;
}

/**
 * For a purchase the recipient is this business, so the place of supply is our
 * state. Different vendor state → IGST; same (or unknown) → CGST + SGST.
 * This is only a suggestion: the vendor's bill is the source of truth.
 */
export function resolvePurchaseSupply(
  ourState: string,
  vendor: { gstin?: string | null; state_code?: string | null } | null | undefined,
): PurchaseSupply {
  const vendorState = vendorStateCode(vendor);
  return { ourState, vendorState, isInterState: vendorState !== null && vendorState !== ourState };
}

function toEngineLine(line: PurchaseLineData): LineInput {
  return {
    quantity: line.quantity,
    unitPricePaise: line.rate_paise,
    priceIncludesTax: line.price_includes_tax,
    discountPaise: line.discount_paise,
    gstRate: line.gst_rate,
    cessRate: line.cess_rate,
  };
}

export interface PurchaseTotals {
  engine: InvoiceTotals;
  roundOffPaise: Paise;
  /** taxable + taxes + round-off. */
  totalPaise: Paise;
}

/** Run the GST engine over validated lines and apply the manual round-off. */
export function computePurchase(lines: PurchaseLineData[], isInterState: boolean, roundOffPaise: Paise): PurchaseTotals {
  if (!Number.isInteger(roundOffPaise) || Math.abs(roundOffPaise) > MAX_ROUND_OFF_PAISE) {
    throw new PurchaseComputeError("Round-off must be between -0.99 and 0.99");
  }
  let engine: InvoiceTotals;
  try {
    engine = computeInvoice({ lines: lines.map(toEngineLine), chargeTax: true, isInterState, roundOff: false });
  } catch (error) {
    if (error instanceof GstEngineError) {
      const where = error.lineIndex === undefined ? "" : `Line ${error.lineIndex + 1}: `;
      throw new PurchaseComputeError(`${where}${error.message}`, error.lineIndex);
    }
    throw error;
  }
  const totalPaise = engine.totalPaise + roundOffPaise;
  if (totalPaise < 0) throw new PurchaseComputeError("The bill total cannot be negative. Check the round-off.");
  return { engine, roundOffPaise, totalPaise };
}

/** The JSON document `save_purchase_bill(p_actor, p)` expects. */
export interface SavePurchaseBillPayload {
  id: string | null;
  business_id: string;
  outlet_id: string;
  vendor_id: string | null;
  vendor_invoice_number: string | null;
  vendor_invoice_date: string | null;
  place_of_supply_state: string;
  is_inter_state: boolean;
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
  round_off_paise: number;
  total_paise: number;
  attachment_paths: string[];
  notes: string | null;
  items: Array<{
    product_id: string | null;
    description: string;
    hsn_code: string | null;
    quantity: string;
    unit_code: string;
    rate_paise: number;
    price_includes_tax: boolean;
    discount_paise: number;
    taxable_paise: number;
    gst_rate: number;
    cess_rate: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    cess_paise: number;
    total_paise: number;
  }>;
}

/**
 * Build the RPC payload on the server from validated input. Every amount comes
 * from the engine here; nothing the browser computed is trusted.
 */
export function buildPurchasePayload(args: {
  businessId: string;
  placeOfSupplyState: string;
  bill: PurchaseBillData;
}): SavePurchaseBillPayload {
  const { bill } = args;
  const { engine, roundOffPaise, totalPaise } = computePurchase(bill.lines, bill.is_inter_state, bill.round_off_paise);
  return {
    id: bill.id,
    business_id: args.businessId,
    outlet_id: bill.outlet_id,
    vendor_id: bill.vendor_id,
    vendor_invoice_number: bill.vendor_invoice_number,
    vendor_invoice_date: bill.vendor_invoice_date,
    place_of_supply_state: args.placeOfSupplyState,
    is_inter_state: bill.is_inter_state,
    subtotal_paise: engine.subtotalPaise,
    discount_paise: engine.discountPaise,
    taxable_paise: engine.taxablePaise,
    cgst_paise: engine.cgstPaise,
    sgst_paise: engine.sgstPaise,
    igst_paise: engine.igstPaise,
    cess_paise: engine.cessPaise,
    round_off_paise: roundOffPaise,
    total_paise: totalPaise,
    attachment_paths: bill.attachment_paths,
    notes: bill.notes,
    items: bill.lines.map((line, i) => {
      const r = engine.lines[i];
      return {
        product_id: line.product_id,
        description: line.description,
        hsn_code: line.hsn_code,
        quantity: line.quantity,
        unit_code: line.unit_code,
        rate_paise: line.rate_paise,
        price_includes_tax: line.price_includes_tax,
        discount_paise: r.lineDiscountPaise,
        taxable_paise: r.taxablePaise,
        gst_rate: line.gst_rate,
        cess_rate: line.cess_rate,
        cgst_paise: r.cgstPaise,
        sgst_paise: r.sgstPaise,
        igst_paise: r.igstPaise,
        cess_paise: r.cessPaise,
        total_paise: r.totalPaise,
      };
    }),
  };
}

/** What `post_purchase_bill` will insist on, checked up front so the form can point at the field. */
export function postingProblems(bill: Pick<PurchaseBillData, "vendor_id" | "vendor_invoice_number" | "vendor_invoice_date" | "lines">): Record<string, string[]> {
  const problems: Record<string, string[]> = {};
  if (!bill.vendor_id) problems.vendor_id = ["Select a vendor before posting"];
  if (!bill.vendor_invoice_number) problems.vendor_invoice_number = ["Enter the vendor's invoice number before posting"];
  if (!bill.vendor_invoice_date) problems.vendor_invoice_date = ["Enter the bill date before posting"];
  if (bill.lines.length === 0) problems.lines = ["Add at least one item before posting"];
  return problems;
}

/** A draft must hold something: an attachment, a vendor, a number or a line. */
export function isEmptyDraft(bill: Pick<PurchaseBillData, "vendor_id" | "vendor_invoice_number" | "attachment_paths" | "lines">): boolean {
  return !bill.vendor_id && !bill.vendor_invoice_number && bill.attachment_paths.length === 0 && bill.lines.length === 0;
}

// ── Live totals while typing ────────────────────────────────────────────────

/** A line as it sits in the form: strings that may be half-typed. */
export interface LooseLine {
  quantity?: string | number | null;
  rate?: string | number | null;
  price_includes_tax?: boolean | null;
  discount?: string | number | null;
  gst_rate?: string | number | null;
  cess_rate?: string | number | null;
}

function looseToEngine(line: LooseLine | undefined): LineInput | null {
  if (!line) return null;
  const quantity = String(line.quantity ?? "").trim();
  if (!/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) return null;
  const rate = rupeesToPaise(line.rate ?? "");
  if (rate === null || rate < 0) return null;
  const discountText = String(line.discount ?? "").trim();
  const discount = discountText === "" ? 0 : rupeesToPaise(discountText);
  if (discount === null || discount < 0) return null;
  const pct = (v: string | number | null | undefined): number | null => {
    const text = String(v ?? "").trim();
    if (text === "") return 0;
    const n = Number(text);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  };
  const gstRate = pct(line.gst_rate);
  const cessRate = pct(line.cess_rate);
  if (gstRate === null || cessRate === null) return null;
  return {
    quantity,
    unitPricePaise: rate,
    priceIncludesTax: !!line.price_includes_tax,
    discountPaise: discount,
    gstRate,
    cessRate,
  };
}

export interface LiveTotals {
  /** One entry per form line; null while that line is incomplete or invalid. */
  lines: Array<LineResult | null>;
  subtotalPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  /** Before the manual round-off. */
  beforeRoundOffPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  /** How many lines could not be included yet. */
  incompleteLines: number;
}

/**
 * Totals for the form as typed. Lines that are not complete yet are left out
 * (and counted) rather than failing the whole bill, so the panel never flickers to zero.
 */
export function liveTotals(lines: Array<LooseLine | undefined>, isInterState: boolean, roundOff: string | number | null | undefined): LiveTotals {
  const results: Array<LineResult | null> = lines.map((line) => {
    const input = looseToEngine(line);
    if (!input) return null;
    try {
      return computeInvoice({ lines: [input], chargeTax: true, isInterState, roundOff: false }).lines[0];
    } catch {
      return null; // e.g. discount larger than the line
    }
  });
  const sum = (pick: (l: LineResult) => Paise) => results.reduce((acc, l) => acc + (l ? pick(l) : 0), 0);
  const taxablePaise = sum((l) => l.taxablePaise);
  const cgstPaise = sum((l) => l.cgstPaise);
  const sgstPaise = sum((l) => l.sgstPaise);
  const igstPaise = sum((l) => l.igstPaise);
  const cessPaise = sum((l) => l.cessPaise);
  const beforeRoundOffPaise = taxablePaise + cgstPaise + sgstPaise + igstPaise + cessPaise;
  const typed = String(roundOff ?? "").trim() === "" ? 0 : rupeesToPaise(roundOff ?? "");
  const roundOffPaise = typed !== null && Math.abs(typed) <= MAX_ROUND_OFF_PAISE ? typed : 0;
  return {
    lines: results,
    subtotalPaise: sum((l) => l.grossPaise),
    discountPaise: sum((l) => l.discountPaise),
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    beforeRoundOffPaise,
    roundOffPaise,
    totalPaise: beforeRoundOffPaise + roundOffPaise,
    incompleteLines: results.filter((r) => r === null).length,
  };
}
