import { headers } from "next/headers";
import Link from "next/link";
import { PackageSearch, Settings, Store } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { buildPosContext } from "@/lib/pos/cart";
import { loadPosCatalog } from "@/lib/pos/load";
import { POS_SHELL_HEADER } from "@/lib/offline/protocol";
import type { SellerSnapshot } from "@/lib/offline/receipt";
import type { CatalogProduct, PosSettings } from "@/lib/pos/types";
import { PosClient } from "./pos-client";

export default async function PosPage() {
  const ctx = await requirePage("sales.create");
  const outlet = ctx.outlet;
  const canSettings = ctx.can("settings.manage");

  if (!outlet) {
    return (
      <div className="p-4">
        <EmptyState icon={Store} title="No outlet to bill from" description="You have not been given access to any outlet. Ask the owner to add you to one." />
      </div>
    );
  }

  // The offline shell (the service worker asks for it with a header) carries no products: the till then runs from its saved catalog.
  const shell = (await headers()).get(POS_SHELL_HEADER) === "1";
  const [seriesResult, catalog] = await Promise.all([
    ctx.supabase
      .from("invoice_series")
      .select("id")
      .eq("business_id", ctx.business.id)
      .eq("outlet_id", outlet.id)
      .eq("document_type", "invoice")
      .is("pos_device_id", null)
      .eq("is_active", true)
      .limit(1),
    shell ? Promise.resolve<CatalogProduct[]>([]) : loadPosCatalog(ctx, outlet.id),
  ]);
  if (seriesResult.error) throw new Error(`Could not check the bill number series: ${seriesResult.error.message}`);

  if (!seriesResult.data || seriesResult.data.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon={Settings}
          title="Bill numbers are not set up for this outlet"
          description={
            canSettings
              ? `Add a bill number series for ${outlet.name} in Settings, then come back to start billing.`
              : `${outlet.name} has no bill number series yet. Ask the owner to add one in Settings.`
          }
          action={
            canSettings ? (
              <Button asChild>
                <Link href="/app/settings/series">Open invoice series settings</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (!ctx.can("products.view")) {
    return (
      <div className="p-4">
        <EmptyState
          icon={PackageSearch}
          title="Your role cannot see products"
          description="Billing needs the product list. Ask the owner to allow your role to view products."
        />
      </div>
    );
  }

  const context = buildPosContext({
    business: ctx.business,
    outlet,
    canDiscount: ctx.can("sales.discount"),
    maxDiscountPercent: Number(ctx.role.max_discount_percent),
    canOverridePrice: ctx.can("sales.price_override"),
  });
  const settings: PosSettings = {
    businessName: ctx.business.trade_name || ctx.business.legal_name,
    outletName: outlet.name,
    upiId: ctx.business.upi_id,
    defaultPrintFormat: ctx.business.default_print_format,
    canViewCustomers: ctx.can("customers.view"),
    // Quick-add reads the new row back, which needs customers.view as well.
    canManageCustomers: ctx.can("customers.manage") && ctx.can("customers.view"),
    emailReceiptsEnabled: ctx.business.notify_email_enabled,
    whatsappReceiptsEnabled: ctx.business.notify_whatsapp_enabled,
  };

  const b = ctx.business;
  // What the thermal slip prints about the seller, so an offline bill can be printed with no server.
  const seller: SellerSnapshot = {
    business: {
      id: b.id,
      legal_name: b.legal_name,
      trade_name: b.trade_name,
      gst_scheme: b.gst_scheme,
      state_code: b.state_code,
      address_line1: b.address_line1,
      address_line2: b.address_line2,
      city: b.city,
      pincode: b.pincode,
      phone: b.phone,
      email: b.email,
      logo_path: b.logo_path,
      brand_color: b.brand_color,
      // Bank details are not printed on a slip and are never sent to the till.
      bank_name: null,
      bank_account_name: null,
      bank_account_number: null,
      ifsc: null,
      upi_id: b.upi_id,
      invoice_terms: b.invoice_terms,
      invoice_footer: b.invoice_footer,
      hsn_digits: b.hsn_digits,
    },
    outlet: {
      id: outlet.id,
      name: outlet.name,
      address_line1: outlet.address_line1,
      address_line2: outlet.address_line2,
      city: outlet.city,
      pincode: outlet.pincode,
      state_code: outlet.state_code,
      phone: outlet.phone,
    },
    sellerGstin: b.gst_scheme === "unregistered" ? null : (outlet.gstin ?? b.gstin),
    cashierName: ctx.profile.full_name?.trim() || null,
    userId: ctx.user.id,
  };

  return (
    <PosClient
      // A different outlet is a different till: fresh bill, its own held bills.
      key={outlet.id}
      catalog={catalog}
      // Empty for the offline shell, so a saved catalog always wins over it.
      catalogVersion={shell ? "" : new Date().toISOString()}
      context={context}
      settings={settings}
      scope={{ businessId: ctx.business.id, outletId: outlet.id }}
      seller={seller}
    />
  );
}
