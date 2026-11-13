import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalesInvoice } from "@/lib/types/db";
import { isPublicTokenShape, isUuid } from "./token";
import type { InvoiceBundle, InvoiceBusiness, InvoiceItemRow, InvoiceOutlet, InvoicePaymentRow } from "./types";

/** Columns the document prints. Nothing about onboarding, stock rules or other settings. */
const BUSINESS_DOCUMENT_COLUMNS =
  "id, legal_name, trade_name, gst_scheme, state_code, address_line1, address_line2, city, pincode, phone, email, " +
  "logo_path, brand_color, bank_name, bank_account_name, bank_account_number, ifsc, upi_id, invoice_terms, " +
  "invoice_footer, hsn_digits";

/** Extra columns for signed-in / worker use: print format and the delivery switches. */
const BUSINESS_INTERNAL_COLUMNS =
  BUSINESS_DOCUMENT_COLUMNS + ", default_print_format, notify_email_enabled, notify_whatsapp_enabled";

const OUTLET_COLUMNS = "id, name, address_line1, address_line2, city, pincode, state_code, phone";

const ITEM_COLUMNS =
  "id, line_no, description, hsn_code, quantity, unit_code, unit_price_paise, price_includes_tax, discount_paise, " +
  "taxable_paise, gst_rate, cess_rate, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise";

const PAYMENT_COLUMNS = "id, mode, amount_paise, reference, is_collection, received_on";

// The app's clients are created without generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export type InvoiceLookup = { id: string } | { token: string };

/**
 * Loads an invoice with its lines, payments, business and outlet.
 *
 * - `{ id }` with the signed-in user's client: RLS decides whether the invoice is visible.
 * - `{ token }` with the admin client (public page / public PDF): returns null when the
 *   token is unknown OR the link has been revoked, so callers cannot tell the two apart.
 *
 * Returns null for anything that is not found. Throws only on a database error.
 */
export async function loadInvoiceBundle(client: AnyClient, by: InvoiceLookup): Promise<InvoiceBundle | null> {
  const byToken = "token" in by;
  if (byToken ? !isPublicTokenShape(by.token) : !isUuid(by.id)) return null;

  const query = client.from("sales_invoices").select("*");
  const { data: invoice, error } = await (byToken
    ? query.eq("public_token", by.token).is("public_token_revoked_at", null)
    : query.eq("id", by.id)
  ).maybeSingle<SalesInvoice>();
  if (error) throw new Error(`Could not load the invoice: ${error.message}`);
  if (!invoice) return null;
  // Belt and braces: compare the token exactly as stored.
  if (byToken && (invoice.public_token !== by.token || invoice.public_token_revoked_at)) return null;

  const [items, payments, business, outlet] = await Promise.all([
    client
      .from("sales_invoice_items")
      .select(ITEM_COLUMNS)
      .eq("invoice_id", invoice.id)
      .order("line_no", { ascending: true })
      .returns<InvoiceItemRow[]>(),
    client
      .from("sales_payments")
      .select(PAYMENT_COLUMNS)
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: true })
      .returns<InvoicePaymentRow[]>(),
    client
      .from("businesses")
      .select(byToken ? BUSINESS_DOCUMENT_COLUMNS : BUSINESS_INTERNAL_COLUMNS)
      .eq("id", invoice.business_id)
      .maybeSingle<InvoiceBusiness>(),
    client.from("outlets").select(OUTLET_COLUMNS).eq("id", invoice.outlet_id).maybeSingle<InvoiceOutlet>(),
  ]);

  const failed = items.error ?? payments.error ?? business.error ?? outlet.error;
  if (failed) throw new Error(`Could not load the invoice: ${failed.message}`);
  if (!business.data) return null;

  return {
    invoice,
    items: items.data ?? [],
    payments: payments.data ?? [],
    business: business.data,
    outlet: outlet.data ?? null,
  };
}
