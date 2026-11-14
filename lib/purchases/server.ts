import "server-only";
import type { AppContext } from "@/lib/auth/context";
import { BUCKETS } from "@/lib/storage";
import { ourStateCode } from "./compute";
import type { GstRateOption, OutletOption, UnitOption, VendorOption } from "./types";

/** Signed URLs (1 hour) for bill attachments in the private bucket. Paths that fail are left out. */
export async function signAttachments(ctx: AppContext, paths: string[] | null | undefined): Promise<Record<string, string>> {
  const own = (paths ?? []).filter((p) => p.startsWith(`${ctx.business.id}/`));
  if (own.length === 0) return {};
  const { data } = await ctx.supabase.storage.from(BUCKETS.purchaseAttachments).createSignedUrls(own, 3600);
  const urls: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) urls[row.path] = row.signedUrl;
  }
  return urls;
}

export function outletOptions(ctx: AppContext): OutletOption[] {
  return ctx.outlets.map((o) => ({ id: o.id, name: o.name, ourState: ourStateCode(o, ctx.business.gstin) }));
}

/** Reference data for the purchase form. */
export async function loadBillFormData(ctx: AppContext): Promise<{
  vendors: VendorOption[];
  /** Vendor ids from this business's latest purchase bills, newest first (may repeat). */
  recentVendorIds: string[];
  units: UnitOption[];
  gstRates: GstRateOption[];
  outlets: OutletOption[];
}> {
  const [vendors, recent, units, rates] = await Promise.all([
    ctx.supabase
      .from("vendors")
      .select("id, name, gstin, state_code, phone")
      .eq("business_id", ctx.business.id)
      .eq("is_active", true)
      .order("name")
      .limit(1000),
    ctx.supabase
      .from("purchase_bills")
      .select("vendor_id")
      .eq("business_id", ctx.business.id)
      .not("vendor_id", "is", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(60),
    ctx.supabase.from("units").select("code, name").eq("is_active", true).order("sort_order"),
    // Purchase bills may carry old slabs (12%, 28%), so inactive rates are offered too, after the active ones.
    ctx.supabase.from("gst_rates").select("rate, label, is_active").order("is_active", { ascending: false }).order("sort_order"),
  ]);
  return {
    vendors: (vendors.data ?? []) as VendorOption[],
    recentVendorIds: ((recent.data ?? []) as { vendor_id: string | null }[]).map((r) => r.vendor_id).filter((id): id is string => !!id),
    units: (units.data ?? []) as UnitOption[],
    gstRates: ((rates.data ?? []) as GstRateOption[]).map((r) => ({ ...r, rate: Number(r.rate) })),
    outlets: outletOptions(ctx),
  };
}
