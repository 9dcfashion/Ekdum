import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { financialYear } from "@/lib/dates";
import { resolveDocumentType } from "@/lib/gst/document";

/** What the small invoice preview needs, taken from the active business and outlet. */
export async function loadPreviewBusiness(ctx: AppContext) {
  const b = ctx.business;
  let prefix = "A";
  if (ctx.outlet) {
    const { data } = await ctx.supabase
      .from("invoice_series")
      .select("prefix")
      .eq("business_id", b.id)
      .eq("outlet_id", ctx.outlet.id)
      .eq("document_type", "invoice")
      .eq("financial_year", financialYear())
      .is("pos_device_id", null)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.prefix) prefix = data.prefix as string;
  }
  return {
    id: b.id,
    name: b.trade_name || b.legal_name,
    address: [b.address_line1, b.city].filter(Boolean).join(", "),
    gstin: b.gstin,
    stateCode: b.state_code,
    documentType: resolveDocumentType({ scheme: b.gst_scheme, lineGstRates: [18], bosForExemptOnly: b.bos_for_exempt_only }),
    prefix,
    footer: b.invoice_footer,
  };
}
