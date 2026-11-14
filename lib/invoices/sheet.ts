import { Decimal } from "@/lib/money";
import { pdfMoney, pdfSigned } from "@/lib/pdf/format";
import type { InvoiceView, InvoiceViewLine } from "./view";

/**
 * The A4 bill as the shopkeepers already know it: an Excel-style grid with a
 * border around every cell. This module decides what goes in each cell; the
 * PDF (lib/pdf/invoice-document.tsx) and the public bill page
 * (components/invoice/invoice-sheet.tsx) only draw it, so the two always match.
 *
 * Pure: strings in, strings out. Money is printed with Indian grouping, two
 * decimals and no currency symbol (the PDF's built-in fonts have no rupee sign).
 */

/**
 * Column widths of the shopkeeper's sheet, in percent of the grid width:
 * A = Sr.No (also the logo box and the "Tax Amount" label), B = description,
 * C = HSN, D = Qty, E = Rate, F = Amount (also the document title box).
 * The left half of every block below the table is A-C, the right half D-F.
 */
export const SHEET_GRID = { a: 9.5, b: 37, c: 13.5, d: 10.2, e: 12.6, f: 17.2 } as const;
export const SHEET_LEFT = SHEET_GRID.a + SHEET_GRID.b + SHEET_GRID.c; // 60
export const SHEET_RIGHT = 100 - SHEET_LEFT; // 40

export type SheetAlign = "left" | "center" | "right";
export type SheetColumnKey = "sr" | "description" | "hsn" | "qty" | "rate" | "discount" | "gst" | "amount";

export interface SheetColumn {
  key: SheetColumnKey;
  label: string;
  /** Share of the grid width, in percent. */
  width: number;
  align: SheetAlign;
}

/** One cell of the buyer / invoice-details block. `accent` cells use the brand colour, in bold. */
export interface SheetText {
  text: string;
  accent?: boolean;
}

/** A row beside the bank details: "Add SGST" | "1.5%" | "1,350.00". */
export interface SheetCharge {
  label: string;
  rate: string;
  amount: string;
}

export interface InvoiceSheet {
  /** "TAX INVOICE" / "BILL OF SUPPLY" / "CASH MEMO" (top-right box). */
  title: string;
  copyLabel: string;
  shopName: string;
  tagline: string | null;
  /** Address, city, state, PIN · phone · email. */
  addressRow: string | null;
  /** Buyer on the left, invoice details on the right; both sides padded to the same number of rows. */
  parties: Array<{ left: SheetText | null; right: SheetText | null }>;
  columns: SheetColumn[];
  rows: Array<{ key: string; cells: string[] }>;
  /** "Total Taxable Amount" on a tax invoice, "Total" otherwise. */
  subtotalLabel: string;
  subtotal: string;
  /** The bill's note, printed in the empty cell left of the subtotal. */
  note: string | null;
  /** Tax, cess and round-off rows; `null` rows are empty cells that give the bank block its height. */
  charges: Array<SheetCharge | null>;
  /** Null when the business has neither bank details nor a UPI ID (the block is left empty). */
  bank: { lines: string[]; upiId: string | null } | null;
  /** The label box left of the words: ["Tax", "Amount"] or ["Amount", "in words"]. */
  wordsLabel: [string, string];
  /** The amount in words, split over the two rows of the block. */
  words: [string, string];
  grandTotal: string;
  /** The bill total in words, in its own row (tax invoices, where the words above are the tax). */
  totalInWords: string | null;
  balanceDue: string | null;
  /** Numbered "1) ...", the composition declaration last. */
  terms: string[];
  signatoryFor: string;
  signatoryLabel: string;
  footer: string | null;
  cancelNote: string | null;
}

/** Rows beside the bank details when a UPI QR is printed there (it needs about three rows of height). */
export const QR_ROWS = 3;

const UNIT_HIDDEN = new Set(["PCS", "NOS"]);

/** "18.00" → "9%", "3" → "1.5%", "0.25" → "0.125%". */
function halfRate(rate: string): string {
  return `${new Decimal(rate).dividedBy(2).toDecimalPlaces(3).toString()}%`;
}

function fullRate(rate: string): string {
  return `${new Decimal(rate).toDecimalPlaces(3).toString()}%`;
}

/** "+919820011001" → "98200 11001"; anything else as stored. */
export function displayPhone(phone: string | null | undefined): string | null {
  const p = (phone ?? "").trim();
  if (!p) return null;
  const m = /^(?:\+?91)?([6-9]\d{4})(\d{5})$/.exec(p.replace(/[\s-]/g, ""));
  return m ? `${m[1]} ${m[2]}` : p;
}

/**
 * Splits the amount in words over the two rows of its block, at the space that
 * keeps the longer line shortest. Short amounts stay on the first row.
 */
export function splitWords(text: string): [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3 || text.length <= 26) return [words.join(" "), ""];
  let best: [string, string] = [text, ""];
  let bestLength = Infinity;
  for (let i = 1; i < words.length; i++) {
    const first = words.slice(0, i).join(" ");
    const second = words.slice(i).join(" ");
    const longer = Math.max(first.length, second.length);
    if (longer < bestLength) {
      best = [first, second];
      bestLength = longer;
    }
  }
  return best;
}

/** A long UPI ID goes under the QR on two lines, split before the "@". */
export function upiIdLines(id: string): string[] {
  const at = id.indexOf("@");
  return id.length > 14 && at > 0 ? [id.slice(0, at), id.slice(at)] : [id];
}

/** Drops numbering the shop typed itself ("1)", "2.", "(3)") so terms are not numbered twice. */
function stripNumbering(term: string): string {
  return term.replace(/^\s*\(?\d{1,2}\s*[).:-]\s*/, "").trim();
}

/**
 * The item table: exactly Sr.No | Description of Goods | HSN Code | Qty | Rate | Amount
 * on a normal bill. "Disc." appears only when a line has a discount, "GST %" only when the
 * bill has more than one GST rate, and a cash memo has no HSN column. Amount is the line's
 * taxable value, so the column adds up to the subtotal below it. The Amount column is always
 * as wide as F, so amounts line up with the totals; extra columns take their room from the
 * description (and slightly narrower Sr.No and HSN columns).
 */
export function sheetColumns(view: InvoiceView): SheetColumn[] {
  const showDiscount = view.lines.some((l) => l.preTaxDiscountPaise > 0);
  const multiRate = view.showTax && view.taxSummary.length > 1;
  const extra = (showDiscount ? 10 : 0) + (multiRate ? 8 : 0);
  const g = SHEET_GRID;
  const sr = extra > 0 ? 6.5 : g.a;
  const hsn = view.showHsn ? (extra > 0 ? 10.5 : g.c) : 0;
  const description = 100 - sr - hsn - g.d - g.e - g.f - extra;

  const columns: SheetColumn[] = [
    { key: "sr", label: "Sr.No", width: sr, align: "center" },
    { key: "description", label: "Description of Goods", width: description, align: "left" },
  ];
  if (view.showHsn) columns.push({ key: "hsn", label: "HSN Code", width: hsn, align: "center" });
  columns.push(
    { key: "qty", label: "Qty", width: g.d, align: "center" },
    { key: "rate", label: "Rate", width: g.e, align: "center" },
  );
  if (showDiscount) columns.push({ key: "discount", label: "Disc.", width: 10, align: "center" });
  if (multiRate) columns.push({ key: "gst", label: "GST %", width: 8, align: "center" });
  columns.push({ key: "amount", label: "Amount", width: g.f, align: "center" });
  return columns;
}

function cellValue(key: SheetColumnKey, line: InvoiceViewLine, index: number, showUnits: boolean): string {
  switch (key) {
    case "sr":
      return String(index + 1);
    case "description":
      return line.description;
    case "hsn":
      return line.hsn;
    case "qty":
      return showUnits && line.unit ? `${line.quantity} ${line.unit}` : line.quantity;
    case "rate":
      return pdfMoney(line.ratePaise);
    case "discount":
      return line.preTaxDiscountPaise > 0 ? pdfMoney(line.preTaxDiscountPaise) : "";
    case "gst":
      return line.gstRate;
    case "amount":
      return pdfMoney(line.taxablePaise);
  }
}

/** Tax rows in the shopkeeper's order: SGST, CGST, then IGST, one set per GST rate. */
function taxCharges(view: InvoiceView): SheetCharge[] {
  if (!view.showTax) return [];
  let groups = view.taxSummary;
  // An exempt (0%) group only adds rows of zeros next to the real rates.
  if (groups.length > 1) groups = groups.filter((g) => Number(g.gstRate) > 0);
  const single = groups.length === 1;
  const rows: SheetCharge[] = [];
  for (const g of groups) {
    const intra = !view.interState;
    // A single-rate bill keeps all three rows, like the printed sheet; the unused ones stay blank.
    if (intra || single) {
      rows.push(
        { label: "Add SGST", rate: halfRate(g.gstRate), amount: intra ? pdfMoney(g.sgstPaise) : "" },
        { label: "Add CGST", rate: halfRate(g.gstRate), amount: intra ? pdfMoney(g.cgstPaise) : "" },
      );
    }
    if (!intra || single) {
      rows.push({ label: "Add IGST", rate: fullRate(g.gstRate), amount: intra ? "" : pdfMoney(g.igstPaise) });
    }
  }
  return rows;
}

function bankBlock(view: InvoiceView): InvoiceSheet["bank"] {
  const lines: string[] = [];
  const b = view.bank;
  if (b) {
    if (b.bankName) lines.push(`BANK DETAIL:- ${b.bankName}`);
    if (b.accountName) lines.push(`A/C NAME: ${b.accountName}`);
    const account = [b.accountNumber ? `A/C NO. ${b.accountNumber}` : null, b.ifsc ? `IFSC: ${b.ifsc}` : null]
      .filter(Boolean)
      .join(" / ");
    if (account) lines.push(account);
  }
  const upiId = view.upi?.id ?? null;
  return lines.length > 0 || upiId ? { lines, upiId } : null;
}

function partiesBlock(view: InvoiceView): InvoiceSheet["parties"] {
  const r = view.recipient;
  const left: SheetText[] = [{ text: `Details of Buyer : ${r?.name ?? "Cash Sale"}` }];
  if (r) {
    const address = r.addressLines;
    if (address.length > 0) {
      left.push({ text: address[0] });
      if (address.length > 1) left.push({ text: address.slice(1).join(", ") });
    } else if (r.phone) {
      left.push({ text: `Ph: ${displayPhone(r.phone)}` });
    }
    if (r.state) left.push({ text: `State: ${r.state}` });
    if (r.gstin) left.push({ text: `GSTIN: ${r.gstin}` });
  }

  const cashMemo = !view.showGstFields;
  const right: SheetText[] = [];
  if (view.seller.gstin) right.push({ text: `GSTIN : ${view.seller.gstin}`, accent: true });
  right.push({ text: `${cashMemo ? "Bill" : "Invoice"} No: ${view.number}` });
  right.push({ text: `${cashMemo ? "Bill" : "Invoice"} Date: ${view.date}` });
  if (view.placeOfSupply) right.push({ text: `Place of Supply: ${view.placeOfSupply}` });
  if (view.reverseCharge) right.push({ text: `Reverse charge(Y/N): ${view.reverseCharge}` });

  const count = Math.max(left.length, right.length);
  return Array.from({ length: count }, (_, i) => ({ left: left[i] ?? null, right: right[i] ?? null }));
}

/** Everything the boxed A4 layout prints, cell by cell. */
export function buildInvoiceSheet(view: InvoiceView): InvoiceSheet {
  const columns = sheetColumns(view);
  const units = new Set(view.lines.map((l) => l.unit.trim().toUpperCase()));
  const showUnits = units.size > 1 || [...units].some((u) => u !== "" && !UNIT_HIDDEN.has(u));
  const rows = view.lines.map((line, index) => ({
    key: `${line.lineNo}`,
    cells: columns.map((c) => cellValue(c.key, line, index, showUnits)),
  }));

  const t = view.totals;
  const charges: Array<SheetCharge | null> = taxCharges(view);
  if (t.cessPaise > 0) charges.push({ label: "Add Cess", rate: "", amount: pdfMoney(t.cessPaise) });
  if (t.roundOffPaise !== 0) charges.push({ label: "Round Off", rate: "", amount: pdfSigned(t.roundOffPaise) });

  const bank = bankBlock(view);
  if (bank) {
    // The bank block is as tall as the rows beside it: pad with empty rows when it needs more.
    const needed = Math.max(bank.lines.length, bank.upiId ? QR_ROWS : 0);
    while (charges.length < needed) charges.push(null);
  }

  const upper = (s: string) => s.toUpperCase();
  const words: [string, string] = view.showTax
    ? splitWords(upper(view.taxAmountInWords ?? ""))
    : splitWords(upper(view.amountInWords));

  const terms = [...view.terms, ...(view.declaration ? [view.declaration] : [])]
    .map(stripNumbering)
    .filter((term) => term.length > 0)
    .map((term, i) => `${i + 1}) ${term}`);

  const contact = [
    view.seller.phone ? `Ph: ${displayPhone(view.seller.phone)}` : null,
    view.seller.email,
  ].filter(Boolean);
  const addressRow = [view.seller.addressRow, ...contact].filter(Boolean).join(" · ") || null;

  return {
    title: view.title.toUpperCase(),
    copyLabel: "Original for Recipient",
    shopName: view.seller.name,
    tagline: view.tagline ?? null,
    addressRow,
    parties: partiesBlock(view),
    columns,
    rows,
    subtotalLabel: view.showTax ? "Total Taxable Amount" : "Total",
    subtotal: pdfMoney(t.taxablePaise),
    note: view.notes ? `Note: ${view.notes}` : null,
    charges,
    bank,
    wordsLabel: view.showTax ? ["Tax", "Amount"] : ["Amount", "in words"],
    words,
    grandTotal: pdfMoney(t.totalPaise),
    totalInWords: view.showTax ? upper(view.amountInWords) : null,
    balanceDue: view.amountDuePaise > 0 ? pdfMoney(view.amountDuePaise) : null,
    terms,
    signatoryFor: view.signatoryFor,
    signatoryLabel: view.signatoryLabel,
    footer: view.footer,
    cancelNote: view.cancelled
      ? `This bill was cancelled.${view.cancelReason ? ` Reason: ${view.cancelReason}` : ""}`
      : null,
  };
}
