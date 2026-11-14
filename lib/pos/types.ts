/**
 * Types shared by the POS cart logic and the POS screen.
 * Framework-free on purpose: the offline POS uses exactly the same shapes
 * with a local catalog, a local customer cache and a local queue.
 */
import type { DocumentType, GstScheme } from "@/lib/gst/config";
import type { PaymentMode, PrintFormat } from "@/lib/types/db";
import type { SaleInput } from "@/lib/validation/sales";

/** Everything billing needs to know about a product, online or offline. */
export interface CatalogProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn_code: string | null;
  unit_code: string;
  /** From `units.allow_decimal`: whether 0.250 KGS makes sense. */
  allow_decimal: boolean;
  gst_rate: number;
  cess_rate: number;
  sale_price_paise: number;
  price_includes_tax: boolean;
  track_inventory: boolean;
  /** Stock at the active outlet. Null when unknown (no permission, or not tracked). */
  stock: number | null;
}

/** A discount typed by the cashier, as an amount or a percentage. */
export type Discount = { kind: "amount"; paise: number } | { kind: "percent"; percent: number };

export interface CartLine {
  /** Row key: the product id, or `manual-…` for an item typed in at the counter. */
  key: string;
  /** Null for a manual item that is not in the product list (no stock is tracked for it). */
  productId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsnCode: string | null;
  unitCode: string;
  allowDecimal: boolean;
  gstRate: number;
  cessRate: number;
  /** The product's price in the catalog when the line was added or last refreshed. */
  listPricePaise: number;
  /** The price charged. Differs from the list price only after a price override. */
  unitPricePaise: number;
  priceIncludesTax: boolean;
  trackInventory: boolean;
  stock: number | null;
  /** Decimal string with up to 3 places, e.g. "2" or "0.250". */
  quantity: string;
  discount: Discount;
}

/** The customer on the bill. `id` is null for a walk-in whose details were only typed in. */
export interface CartCustomer {
  id: string | null;
  name: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  pincode: string;
  state_code: string;
  whatsapp_opt_in: boolean;
}

export interface CartState {
  /** Idempotency key for this bill. Generated once and reused on every retry. */
  clientUuid: string;
  lines: CartLine[];
  billDiscount: Discount;
  supplyType: "b2c" | "b2b";
  customer: CartCustomer | null;
  /** Goods shipped to an address in another state. */
  deliveryStateCode: string | null;
  /** Cashier override of the place of supply, with the reason that goes to the audit log. */
  placeOfSupplyOverride: { stateCode: string; reason: string } | null;
  notes: string;
}

/** What the cart logic needs to know about the seller and the cashier. */
export interface PosContext {
  outletId: string;
  /** Seller state for tax purposes (outlet GSTIN state, else outlet address state). */
  sellerStateCode: string;
  gstScheme: GstScheme;
  roundOff: boolean;
  bosForExemptOnly: boolean;
  allowNegativeStock: boolean;
  canDiscount: boolean;
  /** The role's limit for the total discount on a bill, in percent. */
  maxDiscountPercent: number;
  canOverridePrice: boolean;
}

/** Display settings and permissions for the POS screen (not used by the cart maths). */
export interface PosSettings {
  businessId: string;
  businessName: string;
  outletName: string;
  upiId: string | null;
  defaultPrintFormat: PrintFormat;
  canViewCustomers: boolean;
  canManageCustomers: boolean;
  emailReceiptsEnabled: boolean;
  whatsappReceiptsEnabled: boolean;
  /** Active GST rates, for manual items. */
  gstRates: number[];
  /** Active units, for manual items. */
  units: Array<{ code: string; name: string; allow_decimal: boolean }>;
  /** Preset "quick item" buttons (Settings → Quick billing items), in display order. */
  quickItems: QuickItem[];
}

/**
 * A preset item billed by typing only the rate and quantity (e.g. "Necklace",
 * GST 3%, HSN 7117). It goes on the bill as a manual line: no product, no stock.
 */
export interface QuickItem {
  id: string;
  name: string;
  gstRate: number;
  hsnCode: string | null;
  unitCode: string;
  /** From the unit: whether 0.250 makes sense as a quantity. */
  allowDecimal: boolean;
  priceIncludesTax: boolean;
  defaultRatePaise: number | null;
}

/** An item typed in at the counter because it is not in the product list. */
export interface ManualItemInput {
  /** Unique row key, e.g. `manual-${uuid}` (passed in so the cart logic stays pure). */
  key: string;
  name: string;
  /** Up to 3 decimals when the unit allows it. */
  quantity: string;
  unitPricePaise: number;
  priceIncludesTax: boolean;
  gstRate: number;
  hsnCode: string;
  unitCode: string;
  allowDecimal: boolean;
}

export interface PaymentEntry {
  mode: PaymentMode;
  amountPaise: number;
  reference: string;
}

export type CartResult = { ok: true; cart: CartState } | { ok: false; error: string };

export interface CartIssue {
  code:
    | "empty"
    | "b2b_customer"
    | "discount_not_allowed"
    | "discount_over_limit"
    | "override_reason"
    | "insufficient_stock"
    | "price_override_denied"
    | "invalid_line";
  message: string;
  lineKey?: string;
}

/** A customer as returned by lookup or quick-add. */
export interface PosCustomer {
  /** Empty for a customer typed in while offline: the details go on the bill only, no record is saved. */
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  pincode: string | null;
  state_code: string | null;
  whatsapp_opt_in: boolean;
}

export interface NewCustomerInput {
  name: string;
  phone: string;
  email?: string;
  gstin?: string;
  state_code?: string;
}

/** Simple result for the small POS services (customer lookup, quick-add, email). */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Mirrors `PostResult` from lib/sales/post.ts (which is server-only and cannot be imported here). */
export type SubmitSaleResult =
  | {
      ok: true;
      invoiceId: string;
      invoiceNumber: string;
      publicToken: string;
      duplicate: boolean;
      warnings: Array<{ code: string; message: string }>;
      /** Offline queue only: the bill is saved on this device and will sync later. */
      queued?: boolean;
    }
  | { ok: false; code: string; message: string };

export interface ParkedBill {
  id: string;
  parkedAt: string;
  customerLabel: string;
  itemCount: number;
  totalPaise: number;
  cart: CartState;
}

/** Where held bills live. Online: localStorage. Offline module: Dexie. */
export interface ParkedStore {
  list(): Promise<ParkedBill[]>;
  save(bill: ParkedBill): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Everything the POS screen talks to. Swap these to run the same screen offline. */
export interface PosServices {
  submitSale(input: SaleInput): Promise<SubmitSaleResult>;
  searchCustomers(query: string): Promise<ServiceResult<PosCustomer[]>>;
  createCustomer(input: NewCustomerInput): Promise<ServiceResult<PosCustomer>>;
  sendEmailReceipt(invoiceId: string, email: string): Promise<ServiceResult<null>>;
  parkedStore: ParkedStore;
  /** Offline POS: show and print the slip of a bill saved on this device (no server involved). */
  printQueuedBill?(invoiceId: string): void;
}

export interface PostedBill {
  invoiceId: string;
  invoiceNumber: string;
  publicToken: string;
  totalPaise: number;
  documentType: DocumentType;
  duplicate: boolean;
  queued: boolean;
  warnings: Array<{ code: string; message: string }>;
  emailQueued: boolean;
  whatsappQueued: boolean;
  customerEmail: string;
  /** The customer's mobile on the bill (as typed or saved), for "Send on WhatsApp". Empty when none. */
  customerPhone: string;
  changePaise: number;
}
