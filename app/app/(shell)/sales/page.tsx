import Link from "next/link";
import { Camera, PackagePlus, ReceiptText, ScanBarcode, Undo2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterDate, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage, type AppContext } from "@/lib/auth/context";
import { formatDate, resolveDateRange, type DateRangePreset } from "@/lib/dates";
import { DOCUMENT_TITLES, formatMobile } from "@/lib/gst";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
import type { CreditNote, SalesInvoice } from "@/lib/types/db";
import { cn } from "@/lib/utils";
import { RANGE_OPTIONS, SOURCE_LABELS } from "./labels";

export const metadata = { title: "Sales" };

type InvoiceRow = Pick<
  SalesInvoice,
  | "id"
  | "invoice_number"
  | "invoice_date"
  | "document_type"
  | "supply_type"
  | "customer_name"
  | "customer_phone"
  | "total_paise"
  | "amount_due_paise"
  | "status"
  | "source"
  | "created_by"
  | "outlet_id"
>;

type CreditNoteRow = Pick<
  CreditNote,
  "id" | "credit_note_number" | "credit_note_date" | "total_paise" | "refund_paise" | "adjusted_against_due_paise" | "reason" | "created_by" | "invoice_id"
> & { invoice: { invoice_number: string; customer_name: string | null } | null };

interface Filters {
  q: string;
  range: string;
  from: string | null;
  to: string | null;
  searchingAllDates: boolean;
  status: string;
  outletIds: string[];
  dues: boolean;
  /** Only bills with at least one item that is not in the product list. */
  manual: boolean;
  page: number;
}

function readFilters(sp: SearchParams, ctx: AppContext): Filters {
  const q = param(sp, "q");
  const range = param(sp, "range");
  // A search with no dates chosen looks through every date: nobody remembers which day a bill was made.
  const searchingAllDates = q !== "" && range === "";
  let from: string | null = null;
  let to: string | null = null;
  if (range !== "all" && !searchingAllDates) {
    const preset: DateRangePreset = range === "yesterday" || range === "7d" || range === "30d" || range === "custom" ? range : "today";
    ({ from, to } = resolveDateRange(preset, { from: param(sp, "from"), to: param(sp, "to") }));
  }
  const outlet = param(sp, "outlet");
  const allowed = ctx.outlets.map((o) => o.id);
  return {
    q,
    range,
    from,
    to,
    searchingAllDates,
    status: param(sp, "status"),
    outletIds: allowed.includes(outlet) ? [outlet] : allowed,
    dues: param(sp, "dues") === "1",
    manual: param(sp, "items") === "manual",
    page: pageParam(sp),
  };
}

async function loadNames(ctx: AppContext, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  // created_by points at auth.users, so profiles cannot be embedded: fetch them separately.
  const { data } = await ctx.supabase.from("profiles").select("id, full_name, email").in("id", unique);
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name || p.email || "Staff"]));
}

function Tabs({ active }: { active: "bills" | "credit-notes" }) {
  const tabs = [
    { key: "bills", label: "Bills", href: "/app/sales" },
    { key: "credit-notes", label: "Credit notes", href: "/app/sales?tab=credit-notes" },
  ] as const;
  return (
    <nav aria-label="Sales sections" className="mb-4 flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            active === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function FilterBar({ ctx, filters, tab }: { ctx: AppContext; filters: Filters; tab: "bills" | "credit-notes" }) {
  return (
    <div className="mb-4 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput placeholder={tab === "bills" ? "Bill number, customer or phone" : "Credit note number"} />
        <FilterSelect param="range" label="Dates" options={RANGE_OPTIONS} />
        {filters.range === "custom" ? (
          <>
            <FilterDate param="from" label="From date" />
            <FilterDate param="to" label="To date" />
          </>
        ) : null}
        {tab === "bills" ? (
          <>
            <FilterSelect
              param="status"
              label="Status"
              options={[
                { value: "", label: "Any status" },
                { value: "posted", label: "Posted" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />
            <FilterSelect
              param="dues"
              label="Payment"
              options={[
                { value: "", label: "Any payment" },
                { value: "1", label: "Has dues" },
              ]}
            />
            <FilterSelect
              param="items"
              label="Items"
              options={[
                { value: "", label: "Any items" },
                { value: "manual", label: "Items not in product list" },
              ]}
            />
          </>
        ) : null}
        {ctx.outlets.length > 1 ? (
          <FilterSelect param="outlet" label="Outlet" options={[{ value: "", label: "All outlets" }, ...ctx.outlets.map((o) => ({ value: o.id, label: o.name }))]} />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {filters.searchingAllDates
          ? "Searching all dates."
          : filters.from && filters.to
            ? filters.from === filters.to
              ? `Showing ${formatDate(filters.from)}.`
              : `Showing ${formatDate(filters.from)} to ${formatDate(filters.to)}.`
            : "Showing all dates."}
      </p>
    </div>
  );
}

async function BillsTab({ ctx, filters, hasFilters }: { ctx: AppContext; filters: Filters; hasFilters: boolean }) {
  const [start, end] = pageRange(filters.page);
  let query = ctx.supabase
    .from("sales_invoices")
    .select(
      "id, invoice_number, invoice_date, document_type, supply_type, customer_name, customer_phone, total_paise, amount_due_paise, status, source, created_by, outlet_id" +
        // Inner join keeps only bills that have a manual line; it is not used for display.
        (filters.manual ? ", manual_lines:sales_invoice_items!inner(id)" : ""),
      { count: "exact" },
    )
    .eq("business_id", ctx.business.id)
    .in("outlet_id", filters.outletIds);
  if (filters.from) query = query.gte("invoice_date", filters.from);
  if (filters.to) query = query.lte("invoice_date", filters.to);
  if (filters.status === "posted" || filters.status === "cancelled") query = query.eq("status", filters.status);
  if (filters.dues) query = query.gt("amount_due_paise", 0).eq("status", "posted");
  if (filters.manual) query = query.is("manual_lines.product_id", null);
  const term = ilikeTerm(filters.q);
  if (term) {
    const digits = term.replace(/\D/g, "");
    const parts = [`invoice_number.ilike.%${term}%`, `customer_name.ilike.%${term}%`];
    if (digits.length >= 3) parts.push(`customer_phone.ilike.%${digits.slice(-10)}%`);
    query = query.or(parts.join(","));
  }
  const { data, count, error } = await query
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(start, end);
  if (error) throw new Error(`Could not load bills: ${error.message}`);

  const rows = (data ?? []) as unknown as InvoiceRow[];
  const ids = rows.map((r) => r.id);
  const [names, manualResult, photoResult] = await Promise.all([
    loadNames(ctx, rows.map((r) => r.created_by)),
    ids.length ? ctx.supabase.from("sales_invoice_items").select("invoice_id").in("invoice_id", ids).is("product_id", null) : Promise.resolve({ data: [] }),
    ids.length ? ctx.supabase.from("sales_invoice_photos").select("invoice_id").in("invoice_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const withManual = new Set(((manualResult.data ?? []) as Array<{ invoice_id: string }>).map((r) => r.invoice_id));
  const photoCount = new Map<string, number>();
  for (const r of (photoResult.data ?? []) as Array<{ invoice_id: string }>) photoCount.set(r.invoice_id, (photoCount.get(r.invoice_id) ?? 0) + 1);
  const outletNames = new Map(ctx.outlets.map((o) => [o.id, o.name]));
  const showOutlet = ctx.outlets.length > 1;
  const canBill = ctx.can("sales.create");

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title={hasFilters ? "No bills match these filters" : "No bills yet today"}
        description={hasFilters ? "Try a wider date range or clear the search." : "Bills you make at the counter show up here straight away."}
        action={
          canBill ? (
            <Button asChild>
              <Link href="/app/pos">
                <ScanBarcode aria-hidden /> {hasFilters ? "Make a bill" : "Make your first bill"}
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Bill no.</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Billed by</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={r.status === "cancelled" ? "text-muted-foreground" : undefined}>
                <TableCell className="tabular whitespace-nowrap">{formatDate(r.invoice_date)}</TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <Link href={`/app/sales/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {r.invoice_number}
                    </Link>
                    {withManual.has(r.id) ? (
                      <span title="Has items not in the product list" className="text-indigo-600">
                        <PackagePlus className="size-3.5" aria-hidden />
                        <span className="sr-only">Has items not in the product list</span>
                      </span>
                    ) : null}
                    {photoCount.get(r.id) ? (
                      <span title={`${photoCount.get(r.id)} photo(s) of items given`} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                        <Camera className="size-3.5" aria-hidden />
                        {photoCount.get(r.id)}
                        <span className="sr-only">photos of items given</span>
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="max-w-56">
                  <p className="truncate">{r.customer_name || "Walk-in"}</p>
                  {r.customer_phone ? <p className="tabular truncate text-xs text-muted-foreground">{formatMobile(r.customer_phone)}</p> : null}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="font-medium uppercase">{r.supply_type}</span>
                  <span className="text-muted-foreground"> · {DOCUMENT_TITLES[r.document_type]}</span>
                </TableCell>
                <TableCell className={cn("tabular text-right whitespace-nowrap", r.status === "cancelled" && "line-through")}>{formatINR(r.total_paise)}</TableCell>
                <TableCell className="tabular text-right whitespace-nowrap">
                  {r.amount_due_paise > 0 && r.status === "posted" ? <span className="font-medium text-destructive">{formatINR(r.amount_due_paise)}</span> : "–"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="max-w-40 truncate">{r.created_by ? (names.get(r.created_by) ?? "Staff") : "–"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {SOURCE_LABELS[r.source] ?? r.source}
                  {showOutlet ? ` · ${outletNames.get(r.outlet_id) ?? ""}` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={filters.page} pageSize={PAGE_SIZE} total={count ?? rows.length} />
    </>
  );
}

async function CreditNotesTab({ ctx, filters, hasFilters }: { ctx: AppContext; filters: Filters; hasFilters: boolean }) {
  const [start, end] = pageRange(filters.page);
  let query = ctx.supabase
    .from("credit_notes")
    .select(
      "id, credit_note_number, credit_note_date, total_paise, refund_paise, adjusted_against_due_paise, reason, created_by, invoice_id, invoice:sales_invoices(invoice_number, customer_name)",
      { count: "exact" },
    )
    .eq("business_id", ctx.business.id)
    .in("outlet_id", filters.outletIds);
  if (filters.from) query = query.gte("credit_note_date", filters.from);
  if (filters.to) query = query.lte("credit_note_date", filters.to);
  const term = ilikeTerm(filters.q);
  if (term) query = query.ilike("credit_note_number", `%${term}%`);
  const { data, count, error } = await query
    .order("credit_note_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(start, end);
  if (error) throw new Error(`Could not load credit notes: ${error.message}`);

  const rows = (data ?? []) as unknown as CreditNoteRow[];
  const names = await loadNames(ctx, rows.map((r) => r.created_by));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Undo2}
        title={hasFilters ? "No credit notes match these filters" : "No credit notes today"}
        description="To take back items, open the bill and choose Issue credit note."
        action={
          <Button variant="outline" asChild>
            <Link href="/app/sales?range=30d">Find the bill</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Credit note no.</TableHead>
              <TableHead>Against bill</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Refunded</TableHead>
              <TableHead className="text-right">Set against dues</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Issued by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="tabular whitespace-nowrap">{formatDate(r.credit_note_date)}</TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  <Link href={`/app/sales/credit-notes/${r.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {r.credit_note_number}
                  </Link>
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  <Link href={`/app/sales/${r.invoice_id}`} className="underline-offset-4 hover:underline">
                    {r.invoice?.invoice_number ?? "Open bill"}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 truncate">{r.invoice?.customer_name || "Walk-in"}</TableCell>
                <TableCell className="tabular text-right whitespace-nowrap">{formatINR(r.total_paise)}</TableCell>
                <TableCell className="tabular text-right whitespace-nowrap">{formatINR(r.refund_paise)}</TableCell>
                <TableCell className="tabular text-right whitespace-nowrap">{formatINR(r.adjusted_against_due_paise)}</TableCell>
                <TableCell className="max-w-56 truncate" title={r.reason}>
                  {r.reason}
                </TableCell>
                <TableCell className="max-w-40 truncate">{r.created_by ? (names.get(r.created_by) ?? "Staff") : "–"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={filters.page} pageSize={PAGE_SIZE} total={count ?? rows.length} />
    </>
  );
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage(["sales.view_all", "sales.view_own"]);
  const sp = await searchParams;
  const tab = param(sp, "tab") === "credit-notes" ? "credit-notes" : "bills";
  const filters = readFilters(sp, ctx);
  const hasFilters = ["q", "range", "status", "outlet", "dues", "items"].some((key) => param(sp, key) !== "");
  const ownOnly = !ctx.can("sales.view_all");

  return (
    <>
      <PageHeader
        title="Sales"
        description={ownOnly ? "Bills you have made." : "Every bill made at your outlets."}
        actions={
          ctx.can("sales.create") ? (
            <Button asChild>
              <Link href="/app/pos">
                <ScanBarcode aria-hidden /> New bill
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Tabs active={tab} />
      <FilterBar ctx={ctx} filters={filters} tab={tab} />
      {tab === "bills" ? (
        <BillsTab ctx={ctx} filters={filters} hasFilters={hasFilters} />
      ) : (
        <CreditNotesTab ctx={ctx} filters={filters} hasFilters={hasFilters} />
      )}
    </>
  );
}
