/**
 * Hand-written row types for the tables the app reads most.
 * Once the Supabase project exists these can be replaced with generated types:
 *   pnpm supabase gen types typescript --project-id <ref> > lib/types/database.ts
 * Money columns are bigint in Postgres; PostgREST returns them as JSON numbers.
 */
import type { DocumentType, GstScheme } from "@/lib/gst/config";

export type PrintFormat = "a4" | "thermal_80" | "thermal_58";

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
}

export interface Business {
  id: string;
  legal_name: string;
  trade_name: string | null;
  gst_scheme: GstScheme;
  gstin: string | null;
  pan: string | null;
  state_code: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  logo_path: string | null;
  brand_color: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  ifsc: string | null;
  upi_id: string | null;
  invoice_terms: string | null;
  invoice_footer: string | null;
  round_off_enabled: boolean;
  allow_negative_stock: boolean;
  hsn_digits: 4 | 6 | 8;
  default_print_format: PrintFormat;
  cancel_window_days: number | null;
  bos_for_exempt_only: boolean;
  stuck_shipment_days: number;
  notify_email_enabled: boolean;
  notify_whatsapp_enabled: boolean;
  onboarding_step: number;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface Outlet {
  id: string;
  business_id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string;
  gstin: string | null;
  phone: string | null;
  is_active: boolean;
}

export interface Role {
  id: string;
  business_id: string;
  name: string;
  is_system: boolean;
  system_key: "owner" | "manager" | "cashier" | "dispatch" | null;
  max_discount_percent: number;
}

export interface GstRate {
  id: string;
  rate: number;
  label: string;
  is_active: boolean;
  sort_order: number;
}

export interface Unit {
  code: string;
  name: string;
  allow_decimal: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ProductCategory {
  id: string;
  business_id: string;
  name: string;
  parent_id: string | null;
}

export interface Product {
  id: string;
  business_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  hsn_code: string | null;
  unit_code: string;
  gst_rate: number;
  cess_rate: number;
  sale_price_paise: number;
  price_includes_tax: boolean;
  mrp_paise: number | null;
  track_inventory: boolean;
  low_stock_threshold: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  whatsapp_opt_in: boolean;
  whatsapp_opt_in_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Vendor {
  id: string;
  business_id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

export type MovementType =
  | "opening"
  | "purchase"
  | "sale"
  | "sale_return"
  | "adjustment"
  | "sale_cancel"
  | "purchase_cancel";

export interface StockMovement {
  id: string;
  business_id: string;
  outlet_id: string;
  product_id: string;
  quantity_delta: number;
  movement_type: MovementType;
  source_table: string | null;
  source_id: string | null;
  reason: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PurchaseBill {
  id: string;
  business_id: string;
  outlet_id: string;
  vendor_id: string | null;
  vendor_invoice_number: string | null;
  vendor_invoice_date: string | null;
  financial_year: string | null;
  place_of_supply_state: string | null;
  is_inter_state: boolean;
  status: "draft" | "posted" | "cancelled";
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
  round_off_paise: number;
  total_paise: number;
  amount_paid_paise: number;
  payment_status: "unpaid" | "partial" | "paid";
  attachment_paths: string[];
  notes: string | null;
  posted_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface PurchaseBillItem {
  id: string;
  purchase_bill_id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  hsn_code: string | null;
  quantity: number;
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
}

export interface PurchasePayment {
  id: string;
  purchase_bill_id: string;
  amount_paise: number;
  mode: "cash" | "upi" | "card" | "bank_transfer" | "cheque";
  paid_on: string;
  reference: string | null;
  created_at: string;
}

export interface PosDevice {
  id: string;
  business_id: string;
  outlet_id: string;
  name: string;
  last_seen_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface InvoiceSeries {
  id: string;
  business_id: string;
  outlet_id: string;
  pos_device_id: string | null;
  document_type: "invoice" | "credit_note";
  prefix: string;
  financial_year: string;
  next_number: number;
  is_active: boolean;
}

export type PaymentMode = "cash" | "upi" | "card" | "bank_transfer" | "credit";
export type InvoiceSource = "pos_online" | "pos_offline" | "back_office";

export interface SalesInvoice {
  id: string;
  business_id: string;
  outlet_id: string;
  series_id: string;
  pos_device_id: string | null;
  invoice_number: string;
  financial_year: string;
  document_type: DocumentType;
  invoice_date: string;
  seller_gstin: string | null;
  seller_state_code: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_gstin: string | null;
  customer_address: string | null;
  customer_pincode: string | null;
  customer_state_code: string | null;
  supply_type: "b2b" | "b2c";
  place_of_supply_state: string;
  pos_override_reason: string | null;
  is_inter_state: boolean;
  reverse_charge: boolean;
  subtotal_paise: number;
  discount_paise: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
  round_off_paise: number;
  total_paise: number;
  amount_due_paise: number;
  amount_in_words: string;
  notes: string | null;
  status: "posted" | "cancelled";
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  public_token: string;
  public_token_revoked_at: string | null;
  client_uuid: string;
  source: InvoiceSource;
  created_by: string | null;
  created_at: string;
}

export interface SalesInvoiceItem {
  id: string;
  invoice_id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  hsn_code: string | null;
  quantity: number;
  unit_code: string;
  unit_price_paise: number;
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
}

export interface SalesPayment {
  id: string;
  invoice_id: string;
  mode: PaymentMode;
  amount_paise: number;
  reference: string | null;
  is_collection: boolean;
  received_on: string;
  created_at: string;
}

export interface CreditNote {
  id: string;
  business_id: string;
  outlet_id: string;
  invoice_id: string;
  credit_note_number: string;
  financial_year: string;
  credit_note_date: string;
  seller_gstin: string | null;
  reason: string;
  restock: boolean;
  is_inter_state: boolean;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
  round_off_paise: number;
  total_paise: number;
  adjusted_against_due_paise: number;
  refund_paise: number;
  refund_mode: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CreditNoteItem {
  id: string;
  credit_note_id: string;
  invoice_item_id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  hsn_code: string | null;
  quantity: number;
  unit_code: string;
  unit_price_paise: number;
  taxable_paise: number;
  gst_rate: number;
  cess_rate: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
  total_paise: number;
}

export interface NotificationJob {
  id: string;
  business_id: string;
  channel: "email" | "whatsapp";
  template: string;
  recipient: string;
  payload: Record<string, unknown>;
  related_table: string | null;
  related_id: string | null;
  status: "queued" | "sending" | "sent" | "failed";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface CourierPartner {
  id: string;
  business_id: string;
  name: string;
  tracking_url_template: string | null;
  is_active: boolean;
}

export type ShipmentStatus = "booked" | "picked_up" | "in_transit" | "delivered" | "rto" | "cancelled";

export interface Shipment {
  id: string;
  business_id: string;
  outlet_id: string;
  invoice_id: string | null;
  customer_id: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string | null;
  courier_partner_id: string | null;
  tracking_number: string | null;
  shipped_on: string;
  package_count: number;
  weight_grams: number | null;
  declared_value_paise: number | null;
  receipt_photo_paths: string[];
  status: ShipmentStatus;
  last_status_note: string | null;
  status_changed_at: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ShipmentEvent {
  id: string;
  shipment_id: string;
  status: ShipmentStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  business_id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}
