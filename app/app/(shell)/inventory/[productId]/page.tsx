import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, History, TriangleAlert } from "lucide-react";
import { AdjustStockDialog } from "@/components/inventory/adjust-stock-dialog";
import { OutletFilter } from "@/components/inventory/outlet-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { requirePage } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/dates";
import {
  ledgerCheck,
  movementLabel,
  movementSource,
  reasonLabel,
  runningBalances,
  signedQty,
  stockStatus,
  type StockStatus,
} from "@/lib/inventory/ledger";
import { PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatQty } from "@/lib/money";
import type { StockMovement } from "@/lib/types/db";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation/common";

export const metadata = { title: "Stock ledger" };

const STATUS_BADGE: Record<StockStatus, { label: string; tone: Tone }> = {
  ok: { label: "In stock", tone: "green" },
  low: { label: "Low stock", tone: "amber" },
  out: { label: "Out of stock", tone: "red" },
  negative: { label: "Negative", tone: "red" },
};

const CHUNK = 1000;
const MAX_MOVEMENTS = 100_000;

export default async function StockLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requirePage("inventory.view");
  const { productId } = await params;
  const sp = await searchParams;
  if (!uuid.safeParse(productId).success) notFound();

  const outlet = ctx.outlets.find((o) => o.id === param(sp, "outlet")) ?? ctx.outlet;
  if (!outlet) notFound();
  const page = pageParam(sp);

  const [{ data: productRow }, { data: levelRow }] = await Promise.all([
    ctx.supabase
      .from("products")
      .select("id, name, sku, unit_code, low_stock_threshold, track_inventory, is_active")
      .eq("id", productId)
      .eq("business_id", ctx.business.id)
      .maybeSingle(),
    ctx.supabase
      .from("stock_levels")
      .select("quantity")
      .eq("business_id", ctx.business.id)
      .eq("product_id", productId)
      .eq("outlet_id", outlet.id)
      .maybeSingle(),
  ]);
  const product = productRow as {
    id: string;
    name: string;
    sku: string | null;
    unit_code: string;
    low_stock_threshold: number | null;
    track_inventory: boolean;
    is_active: boolean;
  } | null;
  if (!product) notFound();
  const quantity = Number((levelRow as { quantity: number } | null)?.quantity ?? 0);

  // Every delta, newest first, in the same order as the page below. Only one small
  // column is read, so the running balance and the check line cover the whole ledger.
  const movementsBase = () =>
    ctx.supabase
      .from("stock_movements")
      .select("quantity_delta")
      .eq("business_id", ctx.business.id)
      .eq("product_id", productId)
      .eq("outlet_id", outlet.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  const deltas: number[] = [];
  let complete = true;
  for (let from = 0; ; from += CHUNK) {
    if (from >= MAX_MOVEMENTS) {
      complete = false;
      break;
    }
    const { data, error } = await movementsBase().range(from, from + CHUNK - 1);
    if (error) {
      complete = false;
      break;
    }
    const chunk = (data ?? []) as { quantity_delta: number }[];
    deltas.push(...chunk.map((d) => d.quantity_delta));
    if (chunk.length < CHUNK) break;
  }
  const balances = runningBalances(deltas);
  const check = ledgerCheck(deltas, quantity);

  const [start, end] = pageRange(page);
  const { data: movementRows } = await ctx.supabase
    .from("stock_movements")
    .select("id, quantity_delta, movement_type, source_table, source_id, reason, note, created_by, created_at")
    .eq("business_id", ctx.business.id)
    .eq("product_id", productId)
    .eq("outlet_id", outlet.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, end);
  const movements = (movementRows ?? []) as Pick<
    StockMovement,
    "id" | "quantity_delta" | "movement_type" | "source_table" | "source_id" | "reason" | "note" | "created_by" | "created_at"
  >[];

  // Names (created_by points at auth.users, so profiles cannot be embedded) and credit note → invoice links.
  const userIds = [...new Set(movements.map((m) => m.created_by).filter((v): v is string => !!v))];
  const creditNoteIds = [...new Set(movements.filter((m) => m.source_table === "credit_notes" && m.source_id).map((m) => m.source_id as string))];
  const [profiles, creditNotes] = await Promise.all([
    userIds.length ? ctx.supabase.from("profiles").select("id, full_name, email").in("id", userIds) : Promise.resolve({ data: [] }),
    creditNoteIds.length
      ? ctx.supabase.from("credit_notes").select("id, invoice_id").eq("business_id", ctx.business.id).in("id", creditNoteIds)
      : Promise.resolve({ data: [] }),
  ]);
  const names = new Map(((profiles.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p.full_name || p.email || ""]));
  const creditNoteInvoices = Object.fromEntries(((creditNotes.data ?? []) as { id: string; invoice_id: string }[]).map((c) => [c.id, c.invoice_id]));

  const status = stockStatus(quantity, product.low_stock_threshold);
  const outletOptions = ctx.outlets.map((o) => ({ id: o.id, name: o.name }));
  const canAdjust = ctx.can("inventory.adjust") && product.track_inventory;

  return (
    <>
      <PageHeader
        title={product.name}
        description={`Stock ledger at ${outlet.name}${product.sku ? ` · SKU ${product.sku}` : ""}`}
        backHref={`/app/inventory${outlet.id !== ctx.outlet?.id ? `?outlet=${outlet.id}` : ""}`}
        actions={
          <>
            <OutletFilter outlets={outletOptions} value={outlet.id} />
            {canAdjust ? (
              <AdjustStockDialog
                outlets={outletOptions}
                defaultOutletId={outlet.id}
                product={{ id: product.id, name: product.name, sku: product.sku, unit_code: product.unit_code }}
                currentQuantity={quantity}
              />
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Current stock</p>
          <p className={cn("tabular mt-1 text-2xl font-semibold", quantity < 0 && "text-red-700")}>
            {formatQty(quantity)} <span className="text-sm font-normal text-muted-foreground">{product.unit_code}</span>
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Low-stock limit</p>
          <p className="tabular mt-1 text-2xl font-semibold">
            {product.low_stock_threshold === null ? <span className="text-base font-normal text-muted-foreground">Not set</span> : formatQty(product.low_stock_threshold)}
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">Status</p>
          <div className="mt-2">
            {product.track_inventory ? (
              <StatusBadge label={STATUS_BADGE[status].label} tone={STATUS_BADGE[status].tone} />
            ) : (
              <StatusBadge label="Stock not tracked" tone="gray" />
            )}
          </div>
        </div>
      </div>

      {!ctx.business.allow_negative_stock ? (
        <p className="mb-4 text-xs text-muted-foreground">Sales are blocked when stock runs out. Change this in Settings.</p>
      ) : null}

      {deltas.length === 0 ? (
        <EmptyState
          icon={History}
          title="No stock movements yet"
          description={`Nothing has moved for this product at ${outlet.name}. Stock changes when you post a purchase bill, make a sale or adjust stock.`}
          action={
            ctx.can("purchases.create") ? (
              <Link href="/app/purchases/new" className="text-sm text-primary hover:underline">
                Enter a purchase bill
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <p
            className={cn(
              "tabular mb-3 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-sm",
              !complete ? "bg-muted/40 text-muted-foreground" : check.matches ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700",
            )}
          >
            {complete && check.matches ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>
              {!complete
                ? "This ledger is too long to total on this page, so the running balance may be incomplete."
                : check.matches
                  ? `Ledger total = current stock (${formatQty(check.ledgerTotal)} ${product.unit_code} across ${deltas.length} movement${deltas.length === 1 ? "" : "s"}).`
                  : `Ledger total (${formatQty(check.ledgerTotal)}) does not match current stock (${formatQty(check.stockLevel)}). Difference: ${signedQty(check.difference)}. Please contact support.`}
            </span>
          </p>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Date and time (IST)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Type</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                  <th scope="col" className="px-3 py-2 font-medium">Reason / note</th>
                  <th scope="col" className="px-3 py-2 font-medium">By</th>
                  <th scope="col" className="px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movements.map((m, i) => {
                  const source = movementSource(m, creditNoteInvoices);
                  const balance = balances[start + i];
                  const negative = Number(m.quantity_delta) < 0;
                  return (
                    <tr key={m.id}>
                      <td className="tabular px-3 py-2 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{movementLabel(m.movement_type)}</td>
                      <td className={cn("tabular px-3 py-2 text-right font-medium whitespace-nowrap", negative ? "text-red-700" : "text-emerald-700")}>
                        {signedQty(m.quantity_delta)}
                      </td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">{balance === undefined ? "" : formatQty(balance)}</td>
                      <td className="max-w-72 px-3 py-2">
                        {[reasonLabel(m.reason), m.note].filter(Boolean).join(": ") || <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-3 py-2">{m.created_by ? names.get(m.created_by) || "Team member" : <span className="text-muted-foreground">System</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {source ? (
                          <Link href={source.href} className="text-primary hover:underline">
                            {source.label}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={deltas.length} />
        </>
      )}
    </>
  );
}
