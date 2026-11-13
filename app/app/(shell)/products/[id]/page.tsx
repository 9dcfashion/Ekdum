import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ProductForm } from "@/components/products/product-form";
import { ProductStatusActions } from "@/components/products/product-status-actions";
import { requirePage } from "@/lib/auth/context";
import { paiseToRupees } from "@/lib/money";
import { categoryOptions, loadCategories, loadGstRates, loadUnits } from "@/lib/products/queries";
import type { Product } from "@/lib/types/db";

export const metadata = { title: "Product" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("products.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const canManage = ctx.can("products.manage");
  const canViewCost = ctx.can("products.view_cost");
  const canSeeStock = ctx.can("inventory.view");

  const [{ data: productRow }, categories, rates, units] = await Promise.all([
    ctx.supabase.from("products").select("*").eq("id", id).eq("business_id", ctx.business.id).maybeSingle(),
    loadCategories(ctx),
    loadGstRates(ctx),
    loadUnits(ctx),
  ]);
  const product = productRow as Product | null;
  if (!product) notFound();

  // Cost is a separate table; never read it without the permission.
  let purchasePrice = "";
  if (canViewCost) {
    const { data: cost } = await ctx.supabase
      .from("product_costs")
      .select("purchase_price_paise")
      .eq("product_id", id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    const paise = (cost as { purchase_price_paise: number } | null)?.purchase_price_paise;
    if (typeof paise === "number") purchasePrice = paiseToRupees(paise);
  }

  let stock: Array<{ outlet_id: string; name: string; quantity: number }> | null = null;
  if (canSeeStock && ctx.outlets.length > 0) {
    const { data: levels } = await ctx.supabase
      .from("stock_levels")
      .select("outlet_id, quantity")
      .eq("business_id", ctx.business.id)
      .eq("product_id", id)
      .in(
        "outlet_id",
        ctx.outlets.map((o) => o.id),
      );
    const byOutlet = new Map(
      ((levels ?? []) as { outlet_id: string; quantity: number }[]).map((l) => [l.outlet_id, Number(l.quantity)]),
    );
    stock = ctx.outlets.map((o) => ({ outlet_id: o.id, name: o.name, quantity: byOutlet.get(o.id) ?? 0 }));
  }

  // Keep the product's own rate and unit selectable even if they were retired later.
  const productRate = Number(product.gst_rate);
  const rateOptions = rates
    .filter((r) => r.is_active || r.rate === productRate)
    .map((r) => ({ rate: r.rate, label: r.label }));
  if (!rateOptions.some((r) => r.rate === productRate)) rateOptions.push({ rate: productRate, label: `${productRate}%` });
  const unitOptions = units
    .filter((u) => u.is_active || u.code === product.unit_code)
    .map((u) => ({ code: u.code, name: u.name }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={product.name}
        backHref="/app/products"
        description={canManage ? undefined : "You can view this product but not change it."}
        actions={<StatusBadge status={product.is_active ? "active" : "inactive"} />}
      />
      <ProductForm
        // Remount after every save so the form never holds stale values.
        key={product.updated_at}
        productId={product.id}
        defaults={{
          name: product.name,
          sku: product.sku ?? "",
          barcode: product.barcode ?? "",
          category_id: product.category_id ?? "",
          hsn_code: product.hsn_code ?? "",
          unit_code: product.unit_code,
          gst_rate: String(productRate),
          cess_rate: String(Number(product.cess_rate)),
          sale_price: paiseToRupees(product.sale_price_paise),
          price_includes_tax: product.price_includes_tax,
          mrp: product.mrp_paise === null ? "" : paiseToRupees(product.mrp_paise),
          purchase_price: purchasePrice,
          track_inventory: product.track_inventory,
          low_stock_threshold: product.low_stock_threshold === null ? "" : String(Number(product.low_stock_threshold)),
          is_active: product.is_active,
        }}
        categories={categoryOptions(categories)}
        units={unitOptions}
        gstRates={rateOptions}
        outlets={[]}
        stock={stock}
        canManage={canManage}
        canViewCost={canViewCost}
        chargeTax={ctx.business.gst_scheme === "regular"}
      />
      {canManage ? <ProductStatusActions id={product.id} name={product.name} isActive={product.is_active} /> : null}
    </div>
  );
}
