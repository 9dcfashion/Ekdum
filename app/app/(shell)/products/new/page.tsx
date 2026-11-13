import { PageHeader } from "@/components/shared/page-header";
import { ProductForm } from "@/components/products/product-form";
import { requirePage } from "@/lib/auth/context";
import { categoryOptions, loadCategories, loadGstRates, loadUnits } from "@/lib/products/queries";

export const metadata = { title: "New product" };

export default async function NewProductPage() {
  const ctx = await requirePage("products.manage");
  const [categories, rates, units] = await Promise.all([loadCategories(ctx), loadGstRates(ctx), loadUnits(ctx)]);
  const activeUnits = units.filter((u) => u.is_active);
  const chargeTax = ctx.business.gst_scheme === "regular";
  // Same default as the database column, when that unit is available.
  const defaultUnit = activeUnits.find((u) => u.code === "PCS")?.code ?? activeUnits[0]?.code ?? "";

  return (
    <div className="max-w-3xl">
      <PageHeader title="New product" backHref="/app/products" />
      <ProductForm
        productId={null}
        defaults={{
          name: "",
          sku: "",
          barcode: "",
          category_id: "",
          hsn_code: "",
          unit_code: defaultUnit,
          // A GST business must pick the rate on purpose; others start at 0%.
          gst_rate: chargeTax ? "" : "0",
          cess_rate: "0",
          sale_price: "",
          price_includes_tax: true,
          mrp: "",
          purchase_price: "",
          track_inventory: true,
          low_stock_threshold: "",
          is_active: true,
          opening_stock: ctx.outlets.map((o) => ({ outlet_id: o.id, quantity: "" })),
        }}
        categories={categoryOptions(categories)}
        units={activeUnits.map((u) => ({ code: u.code, name: u.name }))}
        gstRates={rates.filter((r) => r.is_active).map((r) => ({ rate: r.rate, label: r.label }))}
        outlets={ctx.outlets.map((o) => ({ id: o.id, name: o.name }))}
        stock={null}
        canManage
        canViewCost={ctx.can("products.view_cost")}
        chargeTax={chargeTax}
      />
    </div>
  );
}
