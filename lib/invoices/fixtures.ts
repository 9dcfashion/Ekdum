/** Sample invoices for unit tests (view model, PDF, notifications). Not used at runtime. */
import type { DocumentType } from "@/lib/gst/config";
import { amountInWords } from "@/lib/gst/words";
import type { SalesInvoice } from "@/lib/types/db";
import type { InvoiceBundle, InvoiceBusiness, InvoiceItemRow, InvoiceOutlet, InvoicePaymentRow } from "./types";

export const FIXTURE_TOKEN = "a".repeat(64);

export function fixtureBusiness(overrides: Partial<InvoiceBusiness> = {}): InvoiceBusiness {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    legal_name: "Sharma Traders Private Limited",
    trade_name: "Sharma Kirana",
    gst_scheme: "regular",
    state_code: "27",
    address_line1: "12 MG Road",
    address_line2: "Near City Mall",
    city: "Pune",
    pincode: "411001",
    phone: "+919876543210",
    email: "hello@sharmakirana.example",
    logo_path: null,
    brand_color: "#4338CA",
    bank_name: "State Bank of India",
    bank_account_name: "Sharma Traders Pvt Ltd",
    bank_account_number: "123456789012",
    ifsc: "SBIN0001234",
    upi_id: "sharma@okaxis",
    invoice_terms: "Goods once sold will not be taken back.\nSubject to Pune jurisdiction.",
    invoice_footer: "Thank you. Visit again!",
    hsn_digits: 4,
    default_print_format: "thermal_80",
    notify_email_enabled: true,
    notify_whatsapp_enabled: true,
    ...overrides,
  };
}

export function fixtureOutlet(overrides: Partial<InvoiceOutlet> = {}): InvoiceOutlet {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Main Shop",
    address_line1: "12 MG Road",
    address_line2: null,
    city: "Pune",
    pincode: "411001",
    state_code: "27",
    phone: null,
    ...overrides,
  };
}

/** One line of 2 pcs at a taxable value of ₹1,000.00 and 18% GST. */
export function fixtureItem(
  lineNo: number,
  mode: "intra" | "inter" | "none",
  overrides: Partial<InvoiceItemRow> = {},
): InvoiceItemRow {
  const taxable = 100000;
  const tax = mode === "none" ? 0 : 18000;
  return {
    id: `33333333-3333-4333-8333-${String(lineNo).padStart(12, "0")}`,
    line_no: lineNo,
    description: `Basmati Rice 5kg pack ${lineNo}`,
    hsn_code: "10063020",
    quantity: 2,
    unit_code: "PCS",
    unit_price_paise: mode === "none" ? 50000 : 59000,
    price_includes_tax: true,
    discount_paise: 0,
    taxable_paise: taxable,
    gst_rate: mode === "none" ? 0 : 18,
    cess_rate: 0,
    cgst_paise: mode === "intra" ? tax / 2 : 0,
    sgst_paise: mode === "intra" ? tax / 2 : 0,
    igst_paise: mode === "inter" ? tax : 0,
    cess_paise: 0,
    total_paise: taxable + tax,
    ...overrides,
  };
}

export interface FixtureOptions {
  documentType?: DocumentType;
  interState?: boolean;
  lineCount?: number;
  invoice?: Partial<SalesInvoice>;
  business?: Partial<InvoiceBusiness>;
  outlet?: Partial<InvoiceOutlet> | null;
  items?: InvoiceItemRow[];
  payments?: InvoicePaymentRow[];
}

export function fixtureBundle(options: FixtureOptions = {}): InvoiceBundle {
  const documentType = options.documentType ?? "tax_invoice";
  const interState = options.interState ?? false;
  const mode = documentType !== "tax_invoice" ? "none" : interState ? "inter" : "intra";
  const scheme =
    documentType === "cash_memo" ? "unregistered" : documentType === "bill_of_supply" ? "composition" : "regular";
  const items =
    options.items ?? Array.from({ length: options.lineCount ?? 2 }, (_, i) => fixtureItem(i + 1, mode));

  const sum = (key: "taxable_paise" | "cgst_paise" | "sgst_paise" | "igst_paise" | "cess_paise" | "total_paise") =>
    items.reduce((total, item) => total + item[key], 0);
  const roundOff = options.invoice?.round_off_paise ?? 0;
  const total = options.invoice?.total_paise ?? sum("total_paise") + roundOff;

  const invoice: SalesInvoice = {
    id: "44444444-4444-4444-8444-444444444444",
    business_id: "11111111-1111-4111-8111-111111111111",
    outlet_id: "22222222-2222-4222-8222-222222222222",
    series_id: "55555555-5555-4555-8555-555555555555",
    pos_device_id: null,
    invoice_number: "A/2627/00042",
    financial_year: "2627",
    document_type: documentType,
    invoice_date: "2026-11-12",
    seller_gstin: documentType === "cash_memo" ? null : "27AAPFU0939F1ZV",
    seller_state_code: "27",
    customer_id: "66666666-6666-4666-8666-666666666666",
    customer_name: "Anita Deshmukh",
    customer_phone: "+919812345678",
    customer_email: "anita@example.com",
    customer_gstin: null,
    customer_address: "Flat 4, Shanti Niwas\nKarve Nagar, Pune",
    customer_pincode: "411052",
    customer_state_code: interState ? "29" : "27",
    supply_type: "b2c",
    place_of_supply_state: interState ? "29" : "27",
    pos_override_reason: null,
    is_inter_state: interState,
    reverse_charge: false,
    subtotal_paise: sum("taxable_paise"),
    discount_paise: 0,
    taxable_paise: sum("taxable_paise"),
    cgst_paise: sum("cgst_paise"),
    sgst_paise: sum("sgst_paise"),
    igst_paise: sum("igst_paise"),
    cess_paise: sum("cess_paise"),
    round_off_paise: roundOff,
    total_paise: total,
    amount_due_paise: 0,
    amount_in_words: amountInWords(total),
    notes: null,
    status: "posted",
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    public_token: FIXTURE_TOKEN,
    public_token_revoked_at: null,
    client_uuid: "77777777-7777-4777-8777-777777777777",
    source: "pos_online",
    created_by: "88888888-8888-4888-8888-888888888888",
    created_at: "2026-11-12T06:30:00.000Z",
    ...options.invoice,
  };

  return {
    invoice,
    items,
    payments: options.payments ?? [
      {
        id: "99999999-9999-4999-8999-999999999999",
        mode: "cash",
        amount_paise: invoice.total_paise - invoice.amount_due_paise,
        reference: null,
        is_collection: false,
        received_on: invoice.invoice_date,
      },
    ],
    business: fixtureBusiness({
      gst_scheme: scheme,
      ...options.business,
    }),
    outlet: options.outlet === null ? null : fixtureOutlet(options.outlet),
  };
}

/** One tax-exclusive line at 3% GST (intra-state), priced like the jewellery wholesaler's bill. */
function referenceItem(lineNo: number, description: string, quantity: number, ratePaise: number): InvoiceItemRow {
  const taxable = quantity * ratePaise;
  const tax = Math.round(taxable * 0.03);
  return {
    id: `33333333-3333-4333-8333-${String(100 + lineNo).padStart(12, "0")}`,
    line_no: lineNo,
    description,
    hsn_code: "7117",
    quantity,
    unit_code: "PCS",
    unit_price_paise: ratePaise,
    price_includes_tax: false,
    discount_paise: 0,
    taxable_paise: taxable,
    gst_rate: 3,
    cess_rate: 0,
    cgst_paise: Math.floor(tax / 2),
    sgst_paise: tax - Math.floor(tax / 2),
    igst_paise: 0,
    cess_paise: 0,
    total_paise: taxable + tax,
  };
}

/**
 * The bill a jewellery wholesaler in Mumbai already prints from Excel (the layout the A4
 * template copies): two lines at 3% GST to a registered buyer in the same state.
 */
export function referenceBundle(options: FixtureOptions = {}): InvoiceBundle {
  return fixtureBundle({
    outlet: null,
    items: [referenceItem(1, "NECKLACE", 1000, 5000), referenceItem(2, "BRACELETS", 800, 5000)],
    ...options,
    invoice: {
      invoice_number: "A/2526/00163",
      financial_year: "2526",
      invoice_date: "2026-03-22",
      seller_gstin: "27ACAPV1182E1ZP",
      customer_name: "Agrawal Gems",
      customer_phone: null,
      customer_email: null,
      customer_gstin: "27AADFA1321M1ZQ",
      customer_address: "187/193, Kapadia building,shop no 117,Agiary 2nd Lane\nZaveri Bazar, Mumbai-27",
      customer_pincode: null,
      supply_type: "b2b",
      ...options.invoice,
    },
    business: {
      legal_name: "D C FASHION JEWELLERY",
      trade_name: null,
      address_line1: "2ND FLOOR ,SHOP NO 11, CRYSTAL PLAZA,ANAND ROAD",
      address_line2: "MALAD WEST",
      city: "MUMBAI",
      pincode: "400064",
      phone: null,
      email: null,
      brand_color: "#E00000",
      invoice_tagline: "Wholesale Dealer in: Stone Settled Exclusive Fancy Jewellery",
      signatory_label: "Proprietor",
      bank_name: "KOTAK MAHINDRA BANK, #1138 NEVILLA HOUSE , VASAI ROAD EAST, GHOKHIVARA-401208",
      bank_account_name: null,
      bank_account_number: "2512384715",
      ifsc: "KKBK0001347",
      upi_id: null,
      invoice_terms:
        "This is to certify that we have valid Registration Under GST\n" +
        "If Bill not paid within Due date,interest will be charged @\n" +
        "Only Mumbai Courts will have Jurisdiction",
      invoice_footer: null,
      ...options.business,
    },
  });
}
