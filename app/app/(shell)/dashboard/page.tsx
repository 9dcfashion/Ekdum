import Link from "next/link";
import { redirect } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { BarRow, DashCard, KpiTile, MiniStat, Muted } from "@/components/dashboard/cards";
import { GettingStarted, type ChecklistItem } from "@/components/dashboard/getting-started";
import { RangeFilters } from "@/components/dashboard/range-filters";
import { SalesTrendChart } from "@/components/dashboard/sales-trend-chart";
import { TopProducts } from "@/components/dashboard/top-products";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { requirePage, type AppContext } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { SearchParams } from "@/lib/list";
import { formatINR, formatQty } from "@/lib/money";
import type { DashboardSummary } from "@/lib/reports/dashboard";
import { PAYMENT_MODE_LABELS } from "@/lib/reports/definitions";
import { parseFilters } from "@/lib/reports/filters";

export const metadata = { title: "Dashboard" };

/** Head/count query that never throws: RLS or an error simply counts as zero. */
async function countOf(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query;
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

async function loadChecklist(ctx: AppContext): Promise<ChecklistItem[]> {
  const head = { count: "exact", head: true } as const;
  const biz = ctx.business.id;
  const [products, invoices, members, invitations] = await Promise.all([
    countOf(ctx.supabase.from("products").select("id", head).eq("business_id", biz)),
    countOf(ctx.supabase.from("sales_invoices").select("id", head).eq("business_id", biz)),
    countOf(ctx.supabase.from("business_members").select("id", head).eq("business_id", biz)),
    countOf(ctx.supabase.from("invitations").select("id", head).eq("business_id", biz)),
  ]);
  return [
    { key: "products", label: "Add products", hint: "Add what you sell, with price and GST rate.", href: "/app/products/new", done: products >= 1 },
    { key: "bill", label: "Make the first bill", hint: "Open billing and make a sale.", href: "/app/pos", done: invoices >= 1 },
    { key: "staff", label: "Invite staff", hint: "Give your team their own login.", href: "/app/staff", done: members >= 2 || invitations >= 1 },
    { key: "printer", label: "Set up the printer", hint: "Pick thermal or A4 and print a test bill.", href: "/app/settings/invoice", done: false, manual: true },
  ];
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("dashboard.view");
  const sp = await searchParams;
  const filters = parseFilters(sp, ctx.outlets.map((o) => o.id), "today");

  const [summaryResult, checklist] = await Promise.all([
    ctx.supabase.rpc("dashboard_summary", {
      p_business_id: ctx.business.id,
      p_outlet_id: filters.outletId,
      p_from: filters.from,
      p_to: filters.to,
    }),
    loadChecklist(ctx),
  ]);
  if (summaryResult.error) {
    if (summaryResult.error.code === "42501") redirect("/app/no-access");
    throw new Error(`Could not load the dashboard: ${summaryResult.error.message}`);
  }
  const d = summaryResult.data as DashboardSummary;

  const singleDay = filters.from === filters.to;
  const rangeLabel = singleDay ? formatDate(filters.from) : `${formatDate(filters.from)} to ${formatDate(filters.to)}`;
  const hasSales = Number(d.sales.invoice_count) > 0;
  const modesTotal = d.payment_modes.reduce((sum, m) => sum + Number(m.amount_paise), 0);
  const staffMax = Math.max(...d.sales_by_staff.map((s) => Number(s.total_paise)), 0);
  const canPurchases = ctx.can("purchases.view");
  const failed = Number(d.failed_notifications);
  const outletName = filters.outletId ? ctx.outlets.find((o) => o.id === filters.outletId)?.name : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${outletName ?? (ctx.outlets.length > 1 ? "All outlets" : ctx.business.trade_name || ctx.business.legal_name)} · ${rangeLabel} (IST)`}
      />

      <GettingStarted businessId={ctx.business.id} items={checklist} />

      <RangeFilters
        outlets={ctx.outlets.map((o) => ({ id: o.id, name: o.name }))}
        preset={filters.preset}
        from={filters.from}
        to={filters.to}
      />
      {filters.clamped ? (
        <p className="mb-3 text-xs text-muted-foreground">The dashboard shows up to 400 days at a time, so the start date was moved to {formatDate(filters.from)}.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Total sales" value={formatINR(d.sales.total_paise)} hint={`Taxable ${formatINR(d.sales.taxable_paise)}`} />
        <KpiTile label="Bills" value={String(d.sales.invoice_count)} />
        <KpiTile label="Average bill value" value={formatINR(d.sales.average_paise)} />
        <KpiTile label="Tax collected" value={formatINR(d.sales.tax_paise)} hint="CGST + SGST + IGST + cess" />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Discount given" value={formatINR(d.sales.discount_paise)} />
        <MiniStat label="Credit (dues) from this period" value={formatINR(d.sales.due_paise)} />
        <MiniStat label="Cancelled bills" value={String(d.cancelled_count)} />
        <MiniStat label={`Credit notes (${d.credit_notes.count})`} value={formatINR(d.credit_notes.total_paise)} />
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <DashCard title="Sales trend" description={rangeLabel} className="lg:col-span-2">
          {!hasSales ? (
            <EmptyState
              icon={ReceiptText}
              title="No sales in this period"
              description="Bills you make will show up here. Try a longer date range, or make a bill now."
              action={
                ctx.can("sales.create") ? (
                  <Button asChild>
                    <Link href="/app/pos">Make a bill</Link>
                  </Button>
                ) : undefined
              }
              className="h-64 border-0 py-6"
            />
          ) : singleDay ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">Sales on {formatDate(filters.from)}</p>
              <p className="tabular mt-1 text-4xl font-semibold tracking-tight">{formatINR(d.sales.total_paise)}</p>
              <p className="tabular mt-1 text-sm text-muted-foreground">
                {d.sales.invoice_count} {Number(d.sales.invoice_count) === 1 ? "bill" : "bills"}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">Pick 7 days or 30 days to see the trend.</p>
            </div>
          ) : (
            <SalesTrendChart data={d.trend.map((t) => ({ day: t.day, total_paise: Number(t.total_paise), invoice_count: Number(t.invoice_count) }))} />
          )}
        </DashCard>

        <DashCard title="Payment modes" description="Money received in this period">
          {d.payment_modes.length === 0 ? (
            <Muted>No payments in this period.</Muted>
          ) : (
            <ul className="grid gap-2.5">
              {d.payment_modes.map((m) => (
                <BarRow
                  key={m.mode}
                  label={PAYMENT_MODE_LABELS[m.mode] ?? m.mode}
                  value={formatINR(m.amount_paise)}
                  sub={`${m.payment_count} ${Number(m.payment_count) === 1 ? "payment" : "payments"}${
                    modesTotal > 0 ? ` · ${Math.round((Number(m.amount_paise) / modesTotal) * 100)}%` : ""
                  }`}
                  share={modesTotal > 0 ? Number(m.amount_paise) / modesTotal : 0}
                />
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title="Top products">
          <TopProducts byRevenue={d.top_by_revenue} byQuantity={d.top_by_quantity} />
        </DashCard>

        <DashCard title="Sales by staff member">
          {d.sales_by_staff.length === 0 ? (
            <Muted>No sales in this period.</Muted>
          ) : (
            <ul className="grid gap-2.5">
              {d.sales_by_staff.map((s, i) => (
                <BarRow
                  key={s.created_by ?? `unknown-${i}`}
                  label={s.name}
                  value={formatINR(s.total_paise)}
                  sub={`${s.invoice_count} ${Number(s.invoice_count) === 1 ? "bill" : "bills"}`}
                  share={staffMax > 0 ? Number(s.total_paise) / staffMax : 0}
                />
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title="Purchases" description={rangeLabel} href={canPurchases ? "/app/purchases" : undefined}>
          {canPurchases ? (
            <>
              <p className="tabular text-2xl font-semibold tracking-tight">{formatINR(d.purchases.total_paise)}</p>
              <p className="tabular mt-0.5 text-xs text-muted-foreground">
                {d.purchases.count} posted {Number(d.purchases.count) === 1 ? "bill" : "bills"}, by vendor bill date
              </p>
            </>
          ) : (
            <Muted>No access. Your role cannot see purchases.</Muted>
          )}
        </DashCard>

        <DashCard
          title={`Low-stock items (${d.low_stock.count})`}
          description="At or below the low-stock level, right now"
          href="/app/inventory?filter=low"
          linkLabel="View all"
        >
          {d.low_stock.items.length === 0 ? (
            <Muted>Nothing is running low.</Muted>
          ) : (
            <ul className="divide-y text-sm">
              {d.low_stock.items.map((item) => (
                <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">{item.name}</span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    <span className="font-medium text-foreground">{formatQty(item.quantity)}</span> / {formatQty(item.threshold)} {item.unit_code}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {Number(d.low_stock.count) > d.low_stock.items.length ? (
            <p className="mt-2 text-xs text-muted-foreground">and {Number(d.low_stock.count) - d.low_stock.items.length} more</p>
          ) : null}
        </DashCard>

        <DashCard title="Shipments" description="Open parcels, right now" href="/app/shipments" linkLabel="View all">
          <dl className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">Pending</dt>
              <dd className="tabular text-2xl font-semibold tracking-tight">{d.shipments.pending_count}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stuck for more than {d.shipments.stuck_days} days</dt>
              <dd className="tabular text-2xl font-semibold tracking-tight">{d.shipments.stuck_count}</dd>
            </div>
          </dl>
          {d.shipments.stuck.length === 0 ? (
            <Muted>No stuck shipments.</Muted>
          ) : (
            <ul className="divide-y text-sm">
              {d.shipments.stuck.map((s) => (
                <li key={s.id}>
                  <Link href={`/app/shipments/${s.id}`} className="flex items-center justify-between gap-3 py-1.5 hover:bg-muted/50">
                    <span className="min-w-0">
                      <span className="block truncate">{s.recipient_name}</span>
                      <span className="tabular block truncate text-xs text-muted-foreground">
                        {s.tracking_number ? `${s.tracking_number} · ` : ""}sent {formatDate(s.shipped_on)} · {s.days_open} days
                      </span>
                    </span>
                    <StatusBadge status={s.status} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title="Recent cancellations" description="Latest cancelled bills">
          {d.recent_cancellations.length === 0 ? (
            <Muted>No cancelled bills.</Muted>
          ) : (
            <ul className="divide-y text-sm">
              {d.recent_cancellations.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/sales/${c.id}`} className="flex items-baseline justify-between gap-3 py-1.5 hover:bg-muted/50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.invoice_number}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[c.cancelled_at ? formatDateTime(c.cancelled_at) : "", c.cancel_reason].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="tabular shrink-0">{formatINR(c.total_paise)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title="Recent credit notes" description="Latest returns and corrections">
          {d.recent_credit_notes.length === 0 ? (
            <Muted>No credit notes.</Muted>
          ) : (
            <ul className="divide-y text-sm">
              {d.recent_credit_notes.map((c) => (
                <li key={c.id}>
                  <Link href={`/app/sales/${c.invoice_id}`} className="flex items-baseline justify-between gap-3 py-1.5 hover:bg-muted/50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.credit_note_number}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[formatDateTime(c.created_at), c.reason].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="tabular shrink-0">{formatINR(c.total_paise)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        <DashCard title="Failed notifications" href="/app/sales" linkLabel="Open sales">
          <p className="tabular text-2xl font-semibold tracking-tight">{failed}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {failed > 0
              ? "Some bills could not be sent to the customer. Open the bill and tap Resend."
              : "All bills that were sent have gone through."}
          </p>
        </DashCard>

        <section className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center">
          <h2 className="font-medium">Google reviews</h2>
          <p className="text-sm text-muted-foreground">Coming in Phase 2</p>
        </section>
      </div>
    </>
  );
}
