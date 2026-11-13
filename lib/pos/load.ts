import "server-only";
import type { AppContext } from "@/lib/auth/context";
import type { CatalogProduct } from "./types";

/**
 * Loads the POS catalog for one outlet: active products with their price, tax,
 * unit and stock. Used by the POS page and by the "Refresh catalog" action, so
 * the screen and the offline snapshot always have the same shape.
 */

const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default
const MAX_PAGES = 20;

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn_code: string | null;
  unit_code: string;
  gst_rate: number;
  cess_rate: number;
  sale_price_paise: number;
  price_includes_tax: boolean;
  track_inventory: boolean;
}

async function loadProducts(ctx: AppContext): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await ctx.supabase
      .from("products")
      .select("id, name, sku, barcode, hsn_code, unit_code, gst_rate, cess_rate, sale_price_paise, price_includes_tax, track_inventory")
      .eq("business_id", ctx.business.id)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Could not load products: ${error.message}`);
    const batch = (data ?? []) as ProductRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function loadStock(ctx: AppContext, outletId: string): Promise<Map<string, number>> {
  const stock = new Map<string, number>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await ctx.supabase
      .from("stock_levels")
      .select("product_id, quantity")
      .eq("business_id", ctx.business.id)
      .eq("outlet_id", outletId)
      .order("product_id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Could not load stock: ${error.message}`);
    const batch = (data ?? []) as Array<{ product_id: string; quantity: number }>;
    for (const row of batch) stock.set(row.product_id, Number(row.quantity));
    if (batch.length < PAGE) break;
  }
  return stock;
}

export async function loadPosCatalog(ctx: AppContext, outletId: string): Promise<CatalogProduct[]> {
  if (!ctx.can("products.view")) return [];
  const showStock = ctx.can("inventory.view");
  const [unitsResult, products, stock] = await Promise.all([
    ctx.supabase.from("units").select("code, allow_decimal"),
    loadProducts(ctx),
    showStock ? loadStock(ctx, outletId) : Promise.resolve(new Map<string, number>()),
  ]);
  const decimalUnits = new Set(
    ((unitsResult.data ?? []) as Array<{ code: string; allow_decimal: boolean }>).filter((u) => u.allow_decimal).map((u) => u.code),
  );
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    hsn_code: p.hsn_code,
    unit_code: p.unit_code,
    allow_decimal: decimalUnits.has(p.unit_code),
    gst_rate: Number(p.gst_rate),
    cess_rate: Number(p.cess_rate),
    sale_price_paise: Number(p.sale_price_paise),
    price_includes_tax: p.price_includes_tax,
    track_inventory: p.track_inventory,
    // No stock row yet means nothing has been received: zero, not unknown.
    stock: showStock && p.track_inventory ? (stock.get(p.id) ?? 0) : null,
  }));
}
