import Link from "next/link";
import { FolderTree, Package, Plus, Upload } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR, formatQty } from "@/lib/money";
import { categoryOptions, fetchAll, loadCategories } from "@/lib/products/queries";
import type { Product } from "@/lib/types/db";

export const metadata = { title: "Products" };

const COLUMNS =
  "id, business_id, name, sku, barcode, category_id, hsn_code, unit_code, gst_rate, cess_rate, sale_price_paise, price_includes_tax, mrp_paise, track_inventory, low_stock_threshold, is_active, created_at, updated_at";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const STOCK_OPTIONS = [
  { value: "", label: "All stock levels" },
  { value: "low", label: "Low stock" },
];

function isLow(p: Pick<Product, "track_inventory" | "low_stock_threshold">, quantity: number): boolean {
  return p.track_inventory && p.low_stock_threshold !== null && quantity <= Number(p.low_stock_threshold);
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("products.view");
  const sp = await searchParams;
  const q = param(sp, "q");
  const term = ilikeTerm(q);
  const categoryParam = param(sp, "category");
  const status = param(sp, "status");
  const page = pageParam(sp);
  const [from, to] = pageRange(page);
  const canManage = ctx.can("products.manage");
  const outlet = ctx.outlet;
  const showStock = ctx.can("inventory.view") && outlet !== null;
  const lowOnly = showStock && param(sp, "stock") === "low";

  const categories = await loadCategories(ctx);
  const options = categoryOptions(categories);
  const categoryLabel = new Map(options.map((o) => [o.id, o.label]));

  // A parent category also shows the products of its sub-categories.
  let categoryIds: string[] | null = null;
  if (categoryParam && categoryParam !== "none" && categoryLabel.has(categoryParam)) {
    categoryIds = [categoryParam, ...categories.filter((c) => c.parent_id === categoryParam).map((c) => c.id)];
  }

  function filtered(columns: string, withCount = false) {
    let query = ctx.supabase
      .from("products")
      .select(columns, withCount ? { count: "exact" } : undefined)
      .eq("business_id", ctx.business.id);
    if (term) query = query.or(`name.ilike.*${term}*,sku.ilike.*${term}*,barcode.ilike.*${term}*`);
    if (categoryIds) query = query.in("category_id", categoryIds);
    else if (categoryParam === "none") query = query.is("category_id", null);
    if (status === "active") query = query.eq("is_active", true);
    if (status === "inactive") query = query.eq("is_active", false);
    return query;
  }

  let products: Product[] = [];
  let total = 0;
  const stock = new Map<string, number>();

  if (lowOnly && outlet) {
    // No view joins products to stock, so: every product that has a threshold
    // (two small columns) + every stock level of this outlet, compared here.
    // A few thousand rows at most; then only the current page is loaded in full.
    const [candidates, levels] = await Promise.all([
      fetchAll<{ id: string; low_stock_threshold: number }>((f, t) =>
        filtered("id, low_stock_threshold")
          .eq("track_inventory", true)
          .not("low_stock_threshold", "is", null)
          .order("name", { ascending: true })
          .order("id")
          .range(f, t) as unknown as PromiseLike<{
          data: { id: string; low_stock_threshold: number }[] | null;
          error: { message: string } | null;
        }>,
      ),
      fetchAll<{ product_id: string; quantity: number }>((f, t) =>
        ctx.supabase
          .from("stock_levels")
          .select("product_id, quantity")
          .eq("business_id", ctx.business.id)
          .eq("outlet_id", outlet.id)
          .order("product_id")
          .range(f, t),
      ),
    ]);
    for (const l of levels) stock.set(l.product_id, Number(l.quantity));
    const lowIds = candidates
      .filter((c) => (stock.get(c.id) ?? 0) <= Number(c.low_stock_threshold))
      .map((c) => c.id);
    total = lowIds.length;
    const pageIds = lowIds.slice(from, to + 1);
    if (pageIds.length > 0) {
      const { data, error } = await ctx.supabase
        .from("products")
        .select(COLUMNS)
        .eq("business_id", ctx.business.id)
        .in("id", pageIds);
      if (error) throw new Error("Could not load products. Please try again.");
      const byId = new Map(((data ?? []) as unknown as Product[]).map((p) => [p.id, p]));
      products = pageIds.map((id) => byId.get(id)).filter((p): p is Product => !!p);
    }
  } else {
    const { data, count, error } = await filtered(COLUMNS, true)
      .order("name", { ascending: true })
      .order("id")
      .range(from, to);
    if (error) throw new Error("Could not load products. Please try again.");
    products = (data ?? []) as unknown as Product[];
    total = count ?? 0;
    if (showStock && outlet && products.length > 0) {
      const { data: levels } = await ctx.supabase
        .from("stock_levels")
        .select("product_id, quantity")
        .eq("business_id", ctx.business.id)
        .eq("outlet_id", outlet.id)
        .in(
          "product_id",
          products.map((p) => p.id),
        );
      for (const l of (levels ?? []) as { product_id: string; quantity: number }[]) {
        stock.set(l.product_id, Number(l.quantity));
      }
    }
  }

  const isFiltered = q !== "" || categoryParam !== "" || status !== "" || lowOnly;

  const actions = canManage ? (
    <>
      <Button variant="outline" asChild>
        <Link href="/app/products/categories">
          <FolderTree aria-hidden /> Categories
        </Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href="/app/products/import">
          <Upload aria-hidden /> Import CSV
        </Link>
      </Button>
      <Button asChild>
        <Link href="/app/products/new">
          <Plus aria-hidden /> New product
        </Link>
      </Button>
    </>
  ) : null;

  return (
    <>
      <PageHeader title="Products" description="Everything you sell, with prices, tax and stock." actions={actions} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search name, SKU or barcode" />
        <FilterSelect
          param="category"
          label="Filter by category"
          options={[
            { value: "", label: "All categories" },
            ...options.map((o) => ({ value: o.id, label: o.label })),
            { value: "none", label: "No category" },
          ]}
        />
        <FilterSelect param="status" label="Filter by status" options={STATUS_OPTIONS} />
        {showStock ? <FilterSelect param="stock" label="Filter by stock" options={STOCK_OPTIONS} /> : null}
      </div>

      {products.length === 0 ? (
        isFiltered || page > 1 ? (
          <EmptyState
            icon={Package}
            title="No products match"
            description="Try a different search or clear the filters."
            action={
              <Button variant="outline" asChild>
                <Link href="/app/products">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Package}
            title="No products yet"
            description={
              canManage
                ? "Add your first product, or import your whole list from a spreadsheet."
                : "Products added by the owner or manager will show up here."
            }
            action={
              canManage ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button asChild>
                    <Link href="/app/products/new">
                      <Plus aria-hidden /> New product
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/app/products/import">
                      <Upload aria-hidden /> Import CSV
                    </Link>
                  </Button>
                </div>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  {showStock ? <TableHead className="text-right">Stock{outlet ? ` (${outlet.name})` : ""}</TableHead> : null}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => {
                  const quantity = stock.get(p.id) ?? 0;
                  const low = showStock && isLow(p, quantity);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="max-w-64 font-medium">
                        <Link href={`/app/products/${p.id}`} className="block truncate hover:text-primary hover:underline">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground">{p.sku ?? "-"}</TableCell>
                      <TableCell className="tabular text-muted-foreground">{p.barcode ?? "-"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {(p.category_id && categoryLabel.get(p.category_id)) || "-"}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground">{p.hsn_code ?? "-"}</TableCell>
                      <TableCell className="tabular text-right">{Number(p.gst_rate)}%</TableCell>
                      <TableCell className="text-right">
                        <span className="tabular block">{formatINR(p.sale_price_paise)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.price_includes_tax ? "incl. tax" : "excl. tax"}
                        </span>
                      </TableCell>
                      {showStock ? (
                        <TableCell className="text-right">
                          {p.track_inventory ? (
                            <>
                              <span className="tabular">
                                {formatQty(quantity)} <span className="text-xs text-muted-foreground">{p.unit_code}</span>
                              </span>
                              {low ? <StatusBadge tone="amber" label="Low stock" className="ml-2" /> : null}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not tracked</span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <StatusBadge status={p.is_active ? "active" : "inactive"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}
