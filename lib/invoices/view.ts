import { formatDate } from "@/lib/dates";
import { COMPOSITION_DECLARATION, DOCUMENT_TITLES, type DocumentType } from "@/lib/gst/config";
import { upiPaymentUri } from "@/lib/gst/document";
import { formatRate, summariseByRate, type RateSummaryRow } from "@/lib/gst/engine";
import { getState, stateLabel } from "@/lib/gst/states";
import { displayHsn, maskAccountNumber } from "@/lib/gst/validators";
import { formatQty } from "@/lib/money";
import type { PaymentMode } from "@/lib/types/db";
import type { InvoiceBundle } from "./types";

export interface InvoiceViewParty {
  name: string | null;
  phone: string | null;
  email: string | null;
  addressLines: string[];
  gstin: string | null;
  /** "Maharashtra (27)" on GST documents, "Maharashtra" on a cash memo, null when unknown. */
  state: string | null;
}

export interface InvoiceViewLine {
  lineNo: number;
  description: string;
  /** Trimmed to the business's HSN digits. Empty on a cash memo. */
  hsn: string;
  quantity: string;
  unit: string;
  unitPricePaise: number;
  priceIncludesTax: boolean;
  discountPaise: number;
  taxablePaise: number;
  /** "18%". Empty when tax columns are hidden. */
  gstRate: string;
  cessRate: string;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
}

export interface InvoiceViewPayment {
  mode: PaymentMode;
  label: string;
  amountPaise: number;
  reference: string | null;
  date: string;
  /** Collected later against a credit sale. */
  isCollection: boolean;
}

export interface InvoiceView {
  id: string;
  documentType: DocumentType;
  title: string;
  number: string;
  /** DD/MM/YYYY */
  date: string;
  cancelled: boolean;
  cancelReason: string | null;
  brandColor: string;
  logoPath: string | null;

  /** GST documents only (tax invoice, bill of supply). False for a cash memo. */
  showGstFields: boolean;
  /** Tax rate and tax amount columns: tax invoices only. */
  showTax: boolean;
  showHsn: boolean;
  interState: boolean;
  showCess: boolean;
  showDiscount: boolean;

  seller: InvoiceViewParty & {
    name: string;
    /** Legal name, only when it differs from the name shown. */
    legalName: string | null;
    outletName: string | null;
  };
  /** Null when the bill has no customer details at all (walk-in sale). */
  recipient: InvoiceViewParty | null;
  /** Null on a cash memo. */
  placeOfSupply: string | null;
  /** "Yes" / "No". Null on a cash memo. */
  reverseCharge: "Yes" | "No" | null;

  lines: InvoiceViewLine[];
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    cessPaise: number;
    taxPaise: number;
    roundOffPaise: number;
    totalPaise: number;
  };
  /** Empty unless tax is shown. */
  taxSummary: Array<RateSummaryRow & { rateLabel: string }>;
  amountInWords: string;

  payments: InvoiceViewPayment[];
  paidPaise: number;
  amountDuePaise: number;

  bank: {
    bankName: string | null;
    accountName: string | null;
    accountNumber: string | null;
    /** For on-screen views, where the full number must not be shown. */
    accountNumberMasked: string | null;
    ifsc: string | null;
  } | null;
  /** Null when the business has no UPI ID or the bill is cancelled. */
  upi: {
    id: string;
    uri: string;
    /** The exact amount encoded in the QR: the balance due, or the bill total when nothing is due. */
    amountPaise: number;
    /** True when money is still owed on this bill. */
    due: boolean;
  } | null;

  notes: string | null;
  terms: string[];
  footer: string | null;
  /** "Composition taxable person, not eligible to collect tax on supplies." */
  declaration: string | null;
  /** "For {business name}" above "Authorised Signatory". */
  signatoryFor: string;
  signatoryLabel: string;
}

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  credit: "Credit (to be paid)",
};

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

function splitLines(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function joinParts(parts: Array<string | null | undefined>, separator = ", "): string | null {
  const kept = parts.map(clean).filter((p): p is string => p !== null);
  return kept.length > 0 ? kept.join(separator) : null;
}

/** State as printed: name and GST code on GST documents, the plain name otherwise. */
function printState(code: string | null | undefined, withCode: boolean): string | null {
  const state = getState(code);
  if (!state) return null;
  return withCode ? stateLabel(code) : state.name;
}

/**
 * Turns the stored invoice into everything a renderer needs (A4 PDF, thermal
 * slip, public page, email). Pure: no I/O, no clock, no formatting of money
 * (each renderer formats paise for its own medium).
 */
export function buildInvoiceView(bundle: InvoiceBundle): InvoiceView {
  const { invoice, business, outlet } = bundle;
  const documentType = invoice.document_type;
  const isCashMemo = documentType === "cash_memo";
  const showGstFields = !isCashMemo;
  const showTax = documentType === "tax_invoice";
  const cancelled = invoice.status === "cancelled";
  const hsnDigits = business.hsn_digits ?? 4;

  // ── Seller ────────────────────────────────────────────────────────────────
  const sellerName = clean(business.trade_name) ?? business.legal_name.trim();
  const legalName = clean(business.legal_name);
  // The bill is issued from the outlet, so its address is printed; the business address is the fallback.
  const outletHasAddress = !!outlet && !!(clean(outlet.address_line1) || clean(outlet.city));
  const addressSource = outletHasAddress ? outlet! : business;
  const sellerAddress = [
    clean(addressSource.address_line1),
    clean(addressSource.address_line2),
    joinParts([addressSource.city, addressSource.pincode], " - "),
  ].filter((l): l is string => l !== null);

  // ── Recipient ─────────────────────────────────────────────────────────────
  const customerAddress = splitLines(invoice.customer_address);
  const pincode = clean(invoice.customer_pincode);
  if (pincode && !customerAddress.some((l) => l.includes(pincode))) {
    if (customerAddress.length > 0) customerAddress[customerAddress.length - 1] += ` - ${pincode}`;
    else customerAddress.push(pincode);
  }
  const recipientFields: InvoiceViewParty = {
    name: clean(invoice.customer_name),
    phone: clean(invoice.customer_phone),
    email: clean(invoice.customer_email),
    addressLines: customerAddress,
    gstin: showGstFields ? clean(invoice.customer_gstin) : null,
    state: printState(invoice.customer_state_code, showGstFields),
  };
  const hasRecipient =
    !!(recipientFields.name || recipientFields.phone || recipientFields.email || recipientFields.gstin) ||
    recipientFields.addressLines.length > 0;

  // ── Lines ─────────────────────────────────────────────────────────────────
  const items = [...bundle.items].sort((a, b) => a.line_no - b.line_no);
  const lines: InvoiceViewLine[] = items.map((item) => ({
    lineNo: item.line_no,
    description: item.description,
    hsn: showGstFields ? displayHsn(item.hsn_code, hsnDigits) : "",
    quantity: formatQty(item.quantity),
    unit: item.unit_code,
    unitPricePaise: item.unit_price_paise,
    priceIncludesTax: item.price_includes_tax,
    discountPaise: item.discount_paise,
    taxablePaise: item.taxable_paise,
    gstRate: showTax ? formatRate(item.gst_rate) : "",
    cessRate: showTax && Number(item.cess_rate) > 0 ? formatRate(item.cess_rate) : "",
    cgstPaise: showTax ? item.cgst_paise : 0,
    sgstPaise: showTax ? item.sgst_paise : 0,
    igstPaise: showTax ? item.igst_paise : 0,
    cessPaise: showTax ? item.cess_paise : 0,
    totalPaise: item.total_paise,
  }));

  const taxSummary = showTax
    ? summariseByRate(
        items.map((i) => ({
          gstRate: String(i.gst_rate),
          taxablePaise: i.taxable_paise,
          cgstPaise: i.cgst_paise,
          sgstPaise: i.sgst_paise,
          igstPaise: i.igst_paise,
          cessPaise: i.cess_paise,
        })),
      ).map((row) => ({ ...row, rateLabel: formatRate(row.gstRate) }))
    : [];

  // ── Payments ──────────────────────────────────────────────────────────────
  const payments: InvoiceViewPayment[] = bundle.payments.map((p) => ({
    mode: p.mode,
    label: PAYMENT_MODE_LABELS[p.mode] ?? p.mode,
    amountPaise: p.amount_paise,
    reference: clean(p.reference),
    date: formatDate(p.received_on),
    isCollection: p.is_collection,
  }));
  const paidPaise = bundle.payments.filter((p) => p.mode !== "credit").reduce((sum, p) => sum + p.amount_paise, 0);
  const amountDuePaise = cancelled ? 0 : invoice.amount_due_paise;

  // ── Bank and UPI ──────────────────────────────────────────────────────────
  const accountNumber = clean(business.bank_account_number);
  const bankFields = {
    bankName: clean(business.bank_name),
    accountName: clean(business.bank_account_name),
    accountNumber,
    accountNumberMasked: accountNumber ? maskAccountNumber(accountNumber) : null,
    ifsc: clean(business.ifsc),
  };
  const hasBank = !!(bankFields.bankName || bankFields.accountName || bankFields.accountNumber || bankFields.ifsc);

  const upiId = clean(business.upi_id);
  const upiAmount = amountDuePaise > 0 ? amountDuePaise : invoice.total_paise;
  const upi =
    upiId && !cancelled
      ? {
          id: upiId,
          uri: upiPaymentUri({
            upiId,
            payeeName: sellerName,
            amountPaise: upiAmount,
            note: `Bill ${invoice.invoice_number}`,
          }),
          amountPaise: upiAmount,
          due: amountDuePaise > 0,
        }
      : null;

  const showCess = showTax && (invoice.cess_paise > 0 || items.some((i) => i.cess_paise > 0));

  return {
    id: invoice.id,
    documentType,
    title: DOCUMENT_TITLES[documentType],
    number: invoice.invoice_number,
    date: formatDate(invoice.invoice_date),
    cancelled,
    cancelReason: cancelled ? clean(invoice.cancel_reason) : null,
    brandColor: /^#[0-9A-Fa-f]{6}$/.test(business.brand_color ?? "") ? business.brand_color : "#4338CA",
    logoPath: clean(business.logo_path),

    showGstFields,
    showTax,
    showHsn: showGstFields && lines.some((l) => l.hsn.length > 0),
    interState: invoice.is_inter_state,
    showCess,
    showDiscount: items.some((i) => i.discount_paise > 0),

    seller: {
      name: sellerName,
      legalName: legalName && legalName !== sellerName ? legalName : null,
      outletName: clean(outlet?.name),
      phone: clean(outlet?.phone) ?? clean(business.phone),
      email: clean(business.email),
      addressLines: sellerAddress,
      // Never a GSTIN on a cash memo, whatever is stored.
      gstin: showGstFields ? clean(invoice.seller_gstin) : null,
      state: printState(invoice.seller_state_code, showGstFields),
    },
    recipient: hasRecipient ? recipientFields : null,
    placeOfSupply: showGstFields ? printState(invoice.place_of_supply_state, true) : null,
    reverseCharge: showGstFields ? (invoice.reverse_charge ? "Yes" : "No") : null,

    lines,
    totals: {
      subtotalPaise: invoice.subtotal_paise,
      discountPaise: invoice.discount_paise,
      taxablePaise: invoice.taxable_paise,
      cgstPaise: showTax ? invoice.cgst_paise : 0,
      sgstPaise: showTax ? invoice.sgst_paise : 0,
      igstPaise: showTax ? invoice.igst_paise : 0,
      cessPaise: showTax ? invoice.cess_paise : 0,
      taxPaise: showTax ? invoice.cgst_paise + invoice.sgst_paise + invoice.igst_paise + invoice.cess_paise : 0,
      roundOffPaise: invoice.round_off_paise,
      totalPaise: invoice.total_paise,
    },
    taxSummary,
    amountInWords: invoice.amount_in_words,

    payments,
    paidPaise,
    amountDuePaise,

    bank: hasBank ? bankFields : null,
    upi,

    notes: clean(invoice.notes),
    terms: splitLines(business.invoice_terms),
    footer: clean(business.invoice_footer),
    declaration: business.gst_scheme === "composition" ? COMPOSITION_DECLARATION : null,
    signatoryFor: `For ${sellerName}`,
    signatoryLabel: "Authorised Signatory",
  };
}
