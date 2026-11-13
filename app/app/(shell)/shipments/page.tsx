import Link from "next/link";
import { PackagePlus, PackageSearch, Plus, TriangleAlert, Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { formatDate, istDateString } from "@/lib/dates";
import { formatMobile } from "@/lib/gst";
import { ilikeTerm, PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import {
  daysOpen,
  daysOpenLabel,
  isOpenStatus,
  isStuck,
  resolveTab,
  SHIPMENT_TABS,
  type ShipmentStatusKey,
  type ShipmentTabKey,
} from "@/lib/shipments";
import { cn } from "@/lib/utils";

export const metadata = { title: "Shipments" };

interface ListRow {
  id: string;
  recipient_name: string;
  recipient_phone: string | null;
  city: string | null;
  tracking_number: string | null;
  shipped_on: string;
  package_count: number;
  status: ShipmentStatusKey;
  invoice_id: string | null;
  courier: { name: string } | null;
  invoice: { invoice_number: string } | null;
}

const LIST_COLUMNS =
  "id, recipient_name, recipient_phone, city, tracking_number, shipped_on, package_count, status, invoice_id, courier:courier_partners(name), invoice:sales_invoices(invoice_number)";

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("shipments.view");
  const sp = await searchParams;
  const q = param(sp, "q");
  const tab = resolveTab(param(sp, "tab"));
  const page = pageParam(sp);
  const canCreate = ctx.can("shipments.create");
  const today = istDateString();
  const stuckDays = ctx.business.stuck_shipment_days;

  // Outlet scope: the active outlet by default; "all" or another outlet only from the ones this user may access.
  const outletParam = param(sp, "outlet");
  const allowedOutletIds = ctx.outlets.map((o) => o.id);
  const outletIds =
    outletParam === "all" || !ctx.outlet
      ? allowedOutletIds
      : allowedOutletIds.includes(outletParam)
        ? [outletParam]
        : [ctx.outlet.id];

  // Search: tracking number, recipient phone or name, or bill number (bills are looked up first, then matched by id).
  const term = ilikeTerm(q).replace(/\*/g, " ").trim();
  let orFilter: string | null = null;
  if (term) {
    const parts = [`tracking_number.ilike.*${term}*`, `recipient_name.ilike.*${term}*`];
    if (/^[\d\s+-]+$/.test(term)) {
      const digits = term.replace(/\D/g, "");
      if (digits.length >= 3) parts.push(`recipient_phone.ilike.*${digits.length > 10 ? digits.slice(-10) : digits}*`);
    }
    if (term.length >= 2) {
      const { data: invoiceRows } = await ctx.supabase
        .from("sales_invoices")
        .select("id")
        .eq("business_id", ctx.business.id)
        .ilike("invoice_number", `%${term}%`)
        .limit(100);
      const ids = ((invoiceRows ?? []) as { id: string }[]).map((r) => r.id);
      if (ids.length > 0) parts.push(`invoice_id.in.(${ids.join(",")})`);
    }
    orFilter = parts.join(",");
  }

  const statusesFor = (key: ShipmentTabKey) => SHIPMENT_TABS.find((t) => t.key === key)!.statuses;

  function countFor(key: ShipmentTabKey) {
    let query = ctx.supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.business.id)
      .in("outlet_id", outletIds);
    const statuses = statusesFor(key);
    if (statuses) query = query.in("status", [...statuses]);
    if (orFilter) query = query.or(orFilter);
    return query;
  }

  const [from, to] = pageRange(page);
  let listQuery = ctx.supabase
    .from("shipments")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("business_id", ctx.business.id)
    .in("outlet_id", outletIds);
  const tabStatuses = statusesFor(tab);
  if (tabStatuses) listQuery = listQuery.in("status", [...tabStatuses]);
  if (orFilter) listQuery = listQuery.or(orFilter);

  const [list, ...counts] = await Promise.all([
    listQuery.order("shipped_on", { ascending: false }).order("created_at", { ascending: false }).range(from, to),
    ...SHIPMENT_TABS.map((t) => countFor(t.key)),
  ]);
  const rows = (list.data ?? []) as unknown as ListRow[];
  const total = list.count ?? 0;
  const tabCounts = Object.fromEntries(SHIPMENT_TABS.map((t, i) => [t.key, counts[i]?.count ?? 0])) as Record<ShipmentTabKey, number>;

  const tabHref = (key: ShipmentTabKey) => {
    const params = new URLSearchParams();
    if (key !== "pending") params.set("tab", key);
    if (q) params.set("q", q);
    if (outletParam) params.set("outlet", outletParam);
    const query = params.toString();
    return query ? `/app/shipments?${query}` : "/app/shipments";
  };

  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/app/shipments/new">
        <Plus aria-hidden /> New shipment
      </Link>
    </Button>
  ) : null;

  return (
    <div className={cn(canCreate && "pb-20 md:pb-0")}>
      <PageHeader
        title="Shipments"
        description="Parcels sent by courier, and where they are now."
        actions={newButton ? <div className="hidden md:block">{newButton}</div> : undefined}
      />

      <nav aria-label="Shipment lists" className="-mx-3 mb-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1.5">
          {SHIPMENT_TABS.map((t) => {
            const active = t.key === tab;
            return (
              <li key={t.key}>
                <Link
                  href={tabHref(t.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8",
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  <span className={cn("tabular rounded-md px-1.5 text-xs", active ? "bg-primary-foreground/20" : "bg-muted")}>
                    {tabCounts[t.key]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Tracking no., phone or bill no." className="[&_input]:h-11 md:[&_input]:h-8" />
        {ctx.outlets.length > 1 && ctx.outlet ? (
          <FilterSelect
            param="outlet"
            label="Outlet"
            className="h-11 md:h-8"
            options={[
              { value: "", label: `This outlet (${ctx.outlet.name})` },
              { value: "all", label: "All my outlets" },
              ...ctx.outlets.filter((o) => o.id !== ctx.outlet!.id).map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
        ) : null}
      </div>

      {list.error ? (
        <EmptyState icon={TriangleAlert} title="Could not load shipments" description="Please refresh the page and try again." />
      ) : rows.length === 0 ? (
        q ? (
          <EmptyState
            icon={PackageSearch}
            title="No shipments match your search"
            description={
              tab === "all"
                ? "Check the tracking number, phone number or bill number."
                : "Nothing in this list matches. Try the All tab, or check the number."
            }
            action={
              tab !== "all" ? (
                <Button variant="outline" asChild>
                  <Link href={tabHref("all")}>Search all shipments</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={Truck}
            title={tab === "all" ? "No shipments yet" : "Nothing in this list"}
            description={
              tab === "all" || tab === "pending"
                ? "When you send a parcel, add it here to keep the tracking number and receipt in one place."
                : "Shipments move here as their status is updated."
            }
            action={
              canCreate ? (
                <Button asChild>
                  <Link href="/app/shipments/new">
                    <PackagePlus aria-hidden /> New shipment
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          {/* Phones: cards */}
          <ul className="grid gap-2 md:hidden">
            {rows.map((s) => {
              const open = isOpenStatus(s.status);
              const days = daysOpen(s.shipped_on, today);
              const stuck = isStuck(s.status, s.shipped_on, stuckDays, today);
              return (
                <li key={s.id}>
                  <Link
                    href={`/app/shipments/${s.id}`}
                    className="block rounded-xl border p-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">{s.recipient_name}</p>
                      <StatusBadge status={s.status} className="shrink-0" />
                    </div>
                    <p className="mt-1 truncate text-sm">
                      {s.courier?.name ?? "No courier"}
                      {s.tracking_number ? (
                        <>
                          {" · "}
                          <span className="tabular">{s.tracking_number}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground"> · no tracking number</span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[s.recipient_phone ? formatMobile(s.recipient_phone) : null, s.city, s.invoice?.invoice_number ? `Bill ${s.invoice.invoice_number}` : null]
                        .filter(Boolean)
                        .join(" · ") || "No phone number"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular">
                        Shipped {formatDate(s.shipped_on)}
                        {open ? ` · ${days === 0 ? "today" : `${daysOpenLabel(days)} ago`}` : ""}
                      </span>
                      {stuck ? <StatusBadge tone="amber" label={`Stuck: open ${daysOpenLabel(days)}`} /> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop: table */}
          <div className="hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>Tracking no.</TableHead>
                  <TableHead>Bill</TableHead>
                  <TableHead>Shipped</TableHead>
                  <TableHead className="text-right">Days open</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const open = isOpenStatus(s.status);
                  const days = daysOpen(s.shipped_on, today);
                  const stuck = isStuck(s.status, s.shipped_on, stuckDays, today);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/app/shipments/${s.id}`} className="font-medium hover:underline">
                          {s.recipient_name}
                        </Link>
                        <div className="tabular text-xs text-muted-foreground">
                          {[s.recipient_phone ? formatMobile(s.recipient_phone) : null, s.city].filter(Boolean).join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell>{s.courier?.name ?? <span className="text-muted-foreground">None</span>}</TableCell>
                      <TableCell className="tabular">{s.tracking_number ?? ""}</TableCell>
                      <TableCell className="tabular">{s.invoice?.invoice_number ?? ""}</TableCell>
                      <TableCell className="tabular">{formatDate(s.shipped_on)}</TableCell>
                      <TableCell className="tabular text-right">
                        {open ? days : ""}
                        {stuck ? <StatusBadge tone="amber" label="Stuck" className="ml-2" /> : null}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
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

      {canCreate ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <Button asChild size="lg" className="h-12 w-full text-base">
            <Link href="/app/shipments/new">
              <Plus aria-hidden /> New shipment
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
