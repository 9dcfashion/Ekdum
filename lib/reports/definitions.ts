import type { Permission } from "@/lib/auth/permissions";
import type { ReportColumn, ReportRow } from "./format";

/**
 * Every report is defined once here. The on-screen table and the CSV export
 * are both built from these columns, so they can never disagree.
 * Column keys are the column names returned by the RPCs in
 * supabase/migrations/20261112000700_reports.sql.
 */
export interface ReportDefinition {
  key: string;
  title: string;
  /** One line for the index page. */
  description: string;
  /** Longer note shown on the report page. */
  note?: string;
  rpc: string;
  /** False for "as of now" reports that take no date range. */
  hasDates: boolean;
  /** A permission needed in addition to reports.view. */
  requires?: Permission;
  columns: readonly ReportColumn[];
  /** Rows that count towards the totals row (e.g. posted documents only). */
  totalsInclude?: (row: ReportRow) => boolean;
  totalsLabel?: string;
  emptyTitle: string;
}

export const PAYMENT_MODE_LABELS: Readonly<Record<string, string>> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  credit: "Credit (due)",
};

const DOCUMENT_STATUS_LABELS = { posted: "Posted", cancelled: "Cancelled", draft: "Draft" } as const;

const DOCUMENT_TYPE_LABELS = {
  tax_invoice: "Tax invoice",
  bill_of_supply: "Bill of supply",
  cash_memo: "Cash memo",
} as const;

const SOURCE_LABELS = { pos_online: "POS", pos_offline: "POS (offline)", back_office: "Back office" } as const;

const MOVEMENT_LABELS = {
  opening: "Opening stock",
  purchase: "Purchase",
  sale: "Sale",
  sale_return: "Sale return",
  adjustment: "Adjustment",
  sale_cancel: "Sale cancelled",
  purchase_cancel: "Purchase cancelled",
} as const;

const SHIPMENT_STATUS_LABELS = {
  booked: "Booked",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
  rto: "RTO",
  cancelled: "Cancelled",
} as const;

const PAYMENT_STATUS_LABELS = { unpaid: "Unpaid", partial: "Part paid", paid: "Paid" } as const;

/** "cash, upi" → "Cash, UPI". */
function paymentModeList(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value
    .split(",")
    .map((m) => PAYMENT_MODE_LABELS[m.trim()] ?? m.trim())
    .join(", ");
}

const isPosted = (row: ReportRow) => row.status === "posted";

const GSTR_NOTE = "This is a working report to help prepare your return. It is not a GSTR-1 filing.";

export const REPORTS: readonly ReportDefinition[] = [
  {
    key: "sales-register",
    title: "Sales register",
    description: "Every bill in the period, one row per bill, with tax split, B2B or B2C and place of supply.",
    note: `Cancelled bills are listed but left out of the totals. ${GSTR_NOTE}`,
    rpc: "report_sales_register",
    hasDates: true,
    totalsInclude: isPosted,
    totalsLabel: "Total (posted bills)",
    emptyTitle: "No bills in this period",
    columns: [
      { key: "invoice_date", header: "Date", type: "date" },
      { key: "invoice_number", header: "Bill no.", type: "text" },
      { key: "document_type", header: "Type", type: "text", labels: DOCUMENT_TYPE_LABELS },
      { key: "status", header: "Status", type: "text", labels: DOCUMENT_STATUS_LABELS },
      { key: "outlet_name", header: "Outlet", type: "text" },
      { key: "customer_name", header: "Customer", type: "text" },
      { key: "customer_phone", header: "Phone", type: "text" },
      { key: "customer_gstin", header: "Customer GSTIN", type: "text" },
      { key: "supply_type", header: "B2B / B2C", type: "text", labels: { b2b: "B2B", b2c: "B2C" } },
      { key: "place_of_supply_state", header: "Place of supply", type: "state" },
      { key: "is_inter_state", header: "Inter-state", type: "boolean" },
      { key: "subtotal_paise", header: "Subtotal", type: "money", total: true },
      { key: "discount_paise", header: "Discount", type: "money", total: true },
      { key: "taxable_paise", header: "Taxable value", type: "money", total: true },
      { key: "cgst_paise", header: "CGST", type: "money", total: true },
      { key: "sgst_paise", header: "SGST", type: "money", total: true },
      { key: "igst_paise", header: "IGST", type: "money", total: true },
      { key: "cess_paise", header: "Cess", type: "money", total: true },
      { key: "round_off_paise", header: "Round off", type: "money", total: true },
      { key: "total_paise", header: "Total", type: "money", total: true },
      { key: "amount_due_paise", header: "Due", type: "money", total: true },
      { key: "payment_modes", header: "Paid by", type: "text", accessor: (r) => paymentModeList(r.payment_modes) },
      { key: "billed_by", header: "Billed by", type: "text" },
      { key: "source", header: "Source", type: "text", labels: SOURCE_LABELS },
    ],
  },
  {
    key: "item-sales",
    title: "Item-wise sales",
    description: "What sold in the period: quantity, taxable value, tax and total for each item.",
    note: "Posted bills only. Returns on credit notes are not deducted here.",
    rpc: "report_item_sales",
    hasDates: true,
    emptyTitle: "No items sold in this period",
    columns: [
      { key: "description", header: "Item", type: "text" },
      { key: "sku", header: "SKU", type: "text" },
      { key: "hsn_code", header: "HSN / SAC", type: "text" },
      { key: "quantity", header: "Qty", type: "qty" },
      { key: "unit_code", header: "Unit", type: "text" },
      { key: "taxable_paise", header: "Taxable value", type: "money", total: true },
      { key: "tax_paise", header: "Tax", type: "money", total: true },
      { key: "total_paise", header: "Total", type: "money", total: true },
      { key: "invoice_count", header: "Bills", type: "number" },
    ],
  },
  {
    key: "hsn-summary",
    title: "HSN-wise summary",
    description: "Taxable value and CGST, SGST, IGST and cess for each HSN code and GST rate.",
    note: `Posted bills only. Credit notes are reported separately and are not deducted here. ${GSTR_NOTE}`,
    rpc: "report_hsn_summary",
    hasDates: true,
    emptyTitle: "No sales in this period",
    columns: [
      { key: "hsn_code", header: "HSN / SAC", type: "text" },
      { key: "unit_code", header: "Unit", type: "text" },
      { key: "gst_rate", header: "GST rate %", type: "number" },
      { key: "quantity", header: "Qty", type: "qty" },
      { key: "taxable_paise", header: "Taxable value", type: "money", total: true },
      { key: "cgst_paise", header: "CGST", type: "money", total: true },
      { key: "sgst_paise", header: "SGST", type: "money", total: true },
      { key: "igst_paise", header: "IGST", type: "money", total: true },
      { key: "cess_paise", header: "Cess", type: "money", total: true },
      { key: "total_paise", header: "Total", type: "money", total: true },
    ],
  },
  {
    key: "purchase-register",
    title: "Purchase register",
    description: "Every purchase bill in the period by vendor bill date, with tax split and payment status.",
    note: "Cancelled bills are listed but left out of the totals.",
    rpc: "report_purchase_register",
    hasDates: true,
    requires: "purchases.view",
    totalsInclude: isPosted,
    totalsLabel: "Total (posted bills)",
    emptyTitle: "No purchase bills in this period",
    columns: [
      { key: "vendor_invoice_date", header: "Bill date", type: "date" },
      { key: "vendor_invoice_number", header: "Vendor bill no.", type: "text" },
      { key: "vendor_name", header: "Vendor", type: "text" },
      { key: "vendor_gstin", header: "Vendor GSTIN", type: "text" },
      { key: "outlet_name", header: "Outlet", type: "text" },
      { key: "status", header: "Status", type: "text", labels: DOCUMENT_STATUS_LABELS },
      { key: "place_of_supply_state", header: "Place of supply", type: "state" },
      { key: "taxable_paise", header: "Taxable value", type: "money", total: true },
      { key: "cgst_paise", header: "CGST", type: "money", total: true },
      { key: "sgst_paise", header: "SGST", type: "money", total: true },
      { key: "igst_paise", header: "IGST", type: "money", total: true },
      { key: "cess_paise", header: "Cess", type: "money", total: true },
      { key: "round_off_paise", header: "Round off", type: "money", total: true },
      { key: "total_paise", header: "Total", type: "money", total: true },
      { key: "amount_paid_paise", header: "Paid", type: "money", total: true },
      { key: "payment_status", header: "Payment", type: "text", labels: PAYMENT_STATUS_LABELS },
    ],
  },
  {
    key: "stock-summary",
    title: "Stock summary",
    description: "Stock in hand right now for each product and outlet, with low-stock flags.",
    note: "As of now. Cost and stock value are shown only if your role can see cost prices.",
    rpc: "report_stock_summary",
    hasDates: false,
    emptyTitle: "No stock-tracked products yet",
    columns: [
      { key: "name", header: "Product", type: "text" },
      { key: "sku", header: "SKU", type: "text" },
      { key: "barcode", header: "Barcode", type: "text" },
      { key: "category", header: "Category", type: "text" },
      { key: "outlet_name", header: "Outlet", type: "text" },
      { key: "quantity", header: "In stock", type: "qty" },
      { key: "unit_code", header: "Unit", type: "text" },
      { key: "low_stock_threshold", header: "Low-stock level", type: "qty" },
      { key: "is_low", header: "Low", type: "boolean" },
      { key: "sale_price_paise", header: "Sale price", type: "money" },
      { key: "purchase_price_paise", header: "Cost price", type: "money" },
      { key: "stock_value_paise", header: "Stock value", type: "money", total: true },
    ],
  },
  {
    key: "stock-movements",
    title: "Stock movement report",
    description: "Every stock change in the period: sales, purchases, returns and adjustments.",
    rpc: "report_stock_movements",
    hasDates: true,
    emptyTitle: "No stock movements in this period",
    columns: [
      { key: "moved_at", header: "When", type: "datetime" },
      { key: "product_name", header: "Product", type: "text" },
      { key: "sku", header: "SKU", type: "text" },
      { key: "outlet_name", header: "Outlet", type: "text" },
      { key: "movement_type", header: "Type", type: "text", labels: MOVEMENT_LABELS },
      { key: "quantity_delta", header: "Change", type: "qty" },
      { key: "unit_code", header: "Unit", type: "text" },
      { key: "reason", header: "Reason", type: "text" },
      { key: "note", header: "Note", type: "text" },
      { key: "moved_by", header: "By", type: "text" },
    ],
  },
  {
    key: "payment-modes",
    title: "Payment-mode summary",
    description: "Money received each day by cash, UPI, card, bank transfer and credit.",
    note: "By the date the payment was received. Collections are later payments against credit bills.",
    rpc: "report_payment_modes",
    hasDates: true,
    emptyTitle: "No payments in this period",
    columns: [
      { key: "received_on", header: "Date", type: "date" },
      { key: "mode", header: "Mode", type: "text", labels: PAYMENT_MODE_LABELS },
      { key: "kind", header: "Kind", type: "text", labels: { sale: "At sale", collection: "Collection" } },
      { key: "payment_count", header: "Payments", type: "number", total: true },
      { key: "amount_paise", header: "Amount", type: "money", total: true },
    ],
  },
  {
    key: "shipments",
    title: "Shipment report",
    description: "Parcels sent in the period with courier, tracking number, destination and status.",
    rpc: "report_shipments",
    hasDates: true,
    emptyTitle: "No shipments in this period",
    columns: [
      { key: "shipped_on", header: "Shipped on", type: "date" },
      { key: "status", header: "Status", type: "text", labels: SHIPMENT_STATUS_LABELS },
      { key: "courier", header: "Courier", type: "text" },
      { key: "tracking_number", header: "Tracking no.", type: "text" },
      { key: "recipient_name", header: "Recipient", type: "text" },
      { key: "recipient_phone", header: "Phone", type: "text" },
      { key: "city", header: "City", type: "text" },
      { key: "pincode", header: "PIN code", type: "text" },
      { key: "state_code", header: "State", type: "state" },
      { key: "package_count", header: "Packages", type: "number", total: true },
      { key: "weight_grams", header: "Weight (g)", type: "number", total: true },
      { key: "declared_value_paise", header: "Declared value", type: "money", total: true },
      { key: "invoice_number", header: "Bill no.", type: "text" },
      { key: "outlet_name", header: "Outlet", type: "text" },
      { key: "status_changed_at", header: "Status updated", type: "datetime" },
    ],
  },
  {
    key: "credit-notes",
    title: "Credit notes register",
    description: "Every credit note in the period with the original bill, tax split and refund.",
    note: GSTR_NOTE,
    rpc: "report_credit_notes",
    hasDates: true,
    emptyTitle: "No credit notes in this period",
    columns: [
      { key: "credit_note_date", header: "Date", type: "date" },
      { key: "credit_note_number", header: "Credit note no.", type: "text" },
      { key: "invoice_number", header: "Against bill", type: "text" },
      { key: "invoice_date", header: "Bill date", type: "date" },
      { key: "customer_name", header: "Customer", type: "text" },
      { key: "customer_gstin", header: "Customer GSTIN", type: "text" },
      { key: "reason", header: "Reason", type: "text" },
      { key: "restock", header: "Restocked", type: "boolean" },
      { key: "taxable_paise", header: "Taxable value", type: "money", total: true },
      { key: "cgst_paise", header: "CGST", type: "money", total: true },
      { key: "sgst_paise", header: "SGST", type: "money", total: true },
      { key: "igst_paise", header: "IGST", type: "money", total: true },
      { key: "cess_paise", header: "Cess", type: "money", total: true },
      { key: "round_off_paise", header: "Round off", type: "money", total: true },
      { key: "total_paise", header: "Total", type: "money", total: true },
      { key: "refund_paise", header: "Refunded", type: "money", total: true },
      { key: "refund_mode", header: "Refund mode", type: "text", labels: PAYMENT_MODE_LABELS },
      { key: "outlet_name", header: "Outlet", type: "text" },
    ],
  },
];

export function getReport(key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.key === key);
}
