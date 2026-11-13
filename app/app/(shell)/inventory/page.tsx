import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Store } from "lucide-react";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { OutletFilter } from "@/components/inventory/outlet-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { belowThresholdBy, isLowStock, stockStatus, type StockStatus } from "@/lib/inventory/ledger";
import { PAGE_SIZE, ilikeTerm, pageParam, param, type SearchParams } from "@/lib/list";
import { formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation/common";

export const metadata = { title: "Inventory" };

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  unit_code: string;
  low_stock_threshold: number | null;
  category_id: string | null;
  stock_levels: { quantity: number }[] | null;
}

interface StockRow {
  id: string;
  name: string;
  sku: string | null;
  unit_code: string;
  threshold: number | null;
  quantity: number;
  status: StockStatus;
  low: boolean;
}

const STATUS_BADGE: Record<StockStatus, { label: string; tone: Tone }> = {
  ok: { label: "In stock", tone: "green" },
  low: { label: "Low stock", tone: "amber" },
  out: { label: "Out of stock", tone: "red" },
  negative: { label: "Negative", tone: "red" },
};

const VIEWS = [
  { value: "", label: "All stock" },
  { value: "low", label: "Low stock" },
  { value: "out", label: "Out of stock" },
] as const;

const CHUNK = 1000;
const MAX_PRODUCTS = 20_000;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("inventory.view");
  const sp = await searchParams;
  const outlet = ctx.outlets.find((o) => o.id === param(sp, "outlet")) ?? ctx.outlet;

  // Deep link used by other pages: /app/inventory?product={id} opens that product's ledger.
  const productParam = param(sp, "product");
  if (productParam && uuid.safeParse(productParam).success) {
    redirect(`/app/inventory/${productParam}${outlet ? `?outlet=${outlet.id}` : ""}`);
  }

  if (!outlet) {
    return (
      <>
        <PageHeader title="Inventory" />
        <EmptyState icon={Store} title="No outlet available" description="You need access to an outlet to see its stock." />
      </>
    );
  }

  const q = param(sp, "q");
  const view = VIEWS.some((v) => v.value === param(sp, "view")) ? param(sp, "view") : "";
  const categoryId = uuid.safeParse(param(sp, "category")).success ? param(sp, "category") : "";
  const page = pageParam(sp);
  const canAdjust = ctx.can("inventory.adjust");
  const term = ilikeTerm(q);

  // "Low" compares two columns from two tables, which the API cannot filter on, so
  // the tracked products of the business are read (in chunks) and filtered here.
  const products: ProductRow[] = [];
  let failed = false;
  for (let from = 0; from < MAX_PRODUCTS; from += CHUNK) {
    let query = ctx.supabase
      .from("products")
      .select("id, name, sku, unit_code, low_stock_threshold, category_id, stock_levels(quantity)")
      .eq("business_id", ctx.business.id)
      .eq("track_inventory", true)
      .eq("is_active", true)
      .eq("stock_levels.outlet_id", outlet.id);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`);
    const { data, error } = await query.order("name").order("id").range(from, from + CHUNK - 1);
    if (error) {
      failed = true;
      break;
    }
    const chunk = (data ?? []) as unknown as ProductRow[];
    products.push(...chunk);
    if (chunk.length < CHUNK) break;
  }

  const { data: categoryRows } = await ctx.supabase.from("product_categories").select("id, name").eq("business_id", ctx.business.id).order("name");
  const categories = (categoryRows ?? []) as { id: string; name: string }[];

  const all: StockRow[] = products.map((p) => {
    const quantity = Number(p.stock_levels?.[0]?.quantity ?? 0);
    const threshold = p.low_stock_threshold === null ? null : Number(p.low_stock_threshold);
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      unit_code: p.unit_code,
      threshold,
      quantity,
      status: stockStatus(quantity, threshold),
      low: isLowStock(quantity, threshold),
    };
  });
  const counts = { "": all.length, low: all.filter((r) => r.low).length, out: all.filter((r) => r.quantity <= 0).length };

  let rows = all;
  if (view === "low") {
    // Furthest below its threshold first.
    rows = all.filter((r) => r.low).sort((a, b) => belowThresholdBy(a.quantity, a.threshold ?? 0) - belowThresholdBy(b.quantity, b.threshold ?? 0) || a.name.localeCompare(b.name));
  } else if (view === "out") {
    rows = all.filter((r) => r.quantity <= 0);
  }
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const outletOptions = ctx.outlets.map((o) => ({ id: o.id, name: o.name }));
  const hasFilters = !!(q || view || categoryId);

  const viewHref = (value: string) => {
    const params = new URLSearchParams();
    if (outlet.id !== ctx.outlet?.id) params.set("outlet", outlet.id);
    if (q) params.set("q", q);
    if (categoryId) params.set("category", categoryId);
    if (value) params.set("view", value);
    const query = params.toString();
    return query ? `/app/inventory?${query}` : "/app/inventory";
  };

  return (
    <>
      <PageHeader
        title="Inventory"
        description={`Stock at ${outlet.name}. Open a product to see every movement.`}
        actions={canAdjust ? <AdjustStockDialog outlets={outletOptions} defaultOutletId={outlet.id} /> : null}
      />

      {!ctx.business.allow_negative_stock ? (
        <p className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Sales are blocked when stock runs out.{" "}
          {ctx.can("settings.manage") ? (
            <>
              Change this in{" "}
              <Link href="/app/settings" className="text-primary hover:underline">
                Settings
              </Link>
              .
            </>
          ) : (
            "The owner can change this in Settings."
          )}
        </p>
      ) : null}

      <nav aria-label="Stock views" className="mb-3 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link
            key={v.value}
            href={viewHref(v.value)}
            aria-current={view === v.value ? "page" : undefined}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-muted",
              view === v.value ? "border-primary bg-primary/5 font-medium text-primary" : "text-muted-foreground",
            )}
          >
            {v.label} <span className="tabular text-xs">({counts[v.value]})</span>
          </Link>
        ))}
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search name, SKU or barcode" />
        <OutletFilter outlets={outletOptions} value={outlet.id} />
        {categories.length > 0 ? (
          <FilterSelect
            param="category"
            label="Category"
            options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
          />
        ) : null}
      </div>

      {failed ? (
        <EmptyState icon={Boxes} title="Could not load stock" description="Please refresh the page to try again." />
      ) : pageRows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={Boxes}
            title={view === "low" ? "Nothing is running low" : view === "out" ? "Nothing is out of stock" : "No products match"}
            description={view && !q && !categoryId ? `Every tracked product at ${outlet.name} is above its limit.` : "Try a different search or clear the filters."}
            action={
              <Button variant="outline" asChild>
                <Link href={outlet.id !== ctx.outlet?.id ? `/app/inventory?outlet=${outlet.id}` : "/app/inventory"}>Show all stock</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Boxes}
            title="No stock-tracked products yet"
            description="Add products with stock tracking turned on, then post a purchase bill or set opening stock to see quantities here."
            action={
              ctx.can("products.manage") ? (
                <Button asChild>
                  <Link href="/app/products">Go to Products</Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Product</th>
                  <th scope="col" className="px-3 py-2 font-medium">SKU</th>
                  <th scope="col" className="px-3 py-2 font-medium">Unit</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Low-stock limit</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  {canAdjust ? <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="max-w-64 truncate px-3 py-2">
                      <Link href={`/app/inventory/${r.id}?outlet=${outlet.id}`} className="font-medium hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="tabular px-3 py-2">{r.sku ?? ""}</td>
                    <td className="px-3 py-2">{r.unit_code}</td>
                    <td className={cn("tabular px-3 py-2 text-right font-medium", r.quantity < 0 && "text-red-700")}>{formatQty(r.quantity)}</td>
                    <td className="tabular px-3 py-2 text-right">{r.threshold === null ? <span className="text-muted-foreground">Not set</span> : formatQty(r.threshold)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge label={STATUS_BADGE[r.status].label} tone={STATUS_BADGE[r.status].tone} />
                    </td>
                    {canAdjust ? (
                      <td className="px-3 py-1.5 text-right">
                        <AdjustStockDialog
                          variant="row"
                          outlets={outletOptions}
                          defaultOutletId={outlet.id}
                          product={{ id: r.id, name: r.name, sku: r.sku, unit_code: r.unit_code }}
                          currentQuantity={r.quantity}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}
    </>
  );
}
