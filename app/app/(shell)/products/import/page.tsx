import { PageHeader } from "@/components/shared/page-header";
import { ImportWizard } from "@/components/products/import-wizard";
import { requirePage } from "@/lib/auth/context";
import { loadGstRates, loadUnits } from "@/lib/products/queries";

export const metadata = { title: "Import products" };

export default async function ImportProductsPage() {
  const ctx = await requirePage("products.manage");
  const [rates, units] = await Promise.all([loadGstRates(ctx), loadUnits(ctx)]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Import products"
        description="Add or update many products at once from a spreadsheet saved as CSV."
        backHref="/app/products"
      />
      <ImportWizard
        refs={{
          units: units.filter((u) => u.is_active).map((u) => ({ code: u.code, name: u.name })),
          gstRates: rates.filter((r) => r.is_active).map((r) => r.rate),
        }}
        canViewCost={ctx.can("products.view_cost")}
        outletName={ctx.outlet?.name ?? null}
        chargesTax={ctx.business.gst_scheme === "regular"}
      />
    </div>
  );
}
