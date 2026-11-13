import type { Business, Outlet, SalesInvoice, SalesInvoiceItem, SalesPayment } from "@/lib/types/db";

/** Only the business columns an invoice document prints (plus the two delivery switches the worker reads). */
export type InvoiceBusiness = Pick<
  Business,
  | "id"
  | "legal_name"
  | "trade_name"
  | "gst_scheme"
  | "state_code"
  | "address_line1"
  | "address_line2"
  | "city"
  | "pincode"
  | "phone"
  | "email"
  | "logo_path"
  | "brand_color"
  | "bank_name"
  | "bank_account_name"
  | "bank_account_number"
  | "ifsc"
  | "upi_id"
  | "invoice_terms"
  | "invoice_footer"
  | "hsn_digits"
> &
  Partial<Pick<Business, "default_print_format" | "notify_email_enabled" | "notify_whatsapp_enabled">>;

export type InvoiceOutlet = Pick<
  Outlet,
  "id" | "name" | "address_line1" | "address_line2" | "city" | "pincode" | "state_code" | "phone"
>;

export type InvoiceItemRow = Pick<
  SalesInvoiceItem,
  | "id"
  | "line_no"
  | "description"
  | "hsn_code"
  | "quantity"
  | "unit_code"
  | "unit_price_paise"
  | "price_includes_tax"
  | "discount_paise"
  | "taxable_paise"
  | "gst_rate"
  | "cess_rate"
  | "cgst_paise"
  | "sgst_paise"
  | "igst_paise"
  | "cess_paise"
  | "total_paise"
>;

export type InvoicePaymentRow = Pick<
  SalesPayment,
  "id" | "mode" | "amount_paise" | "reference" | "is_collection" | "received_on"
>;

/** Everything needed to render one invoice, in any format. */
export interface InvoiceBundle {
  invoice: SalesInvoice;
  items: InvoiceItemRow[];
  payments: InvoicePaymentRow[];
  business: InvoiceBusiness;
  outlet: InvoiceOutlet | null;
}
