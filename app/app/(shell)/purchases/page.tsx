import Link from "next/link";
import { FileText, ImageIcon, Plus, ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterDate, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { requirePage, type AppContext } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
import { signAttachments } from "@/lib/purchases/server";
import type { PurchaseBill } from "@/lib/types/db";

export const metadata = { title: "Purchases" };

type BillRow = Pick<
  PurchaseBill,
  | "id"
  | "outlet_id"
  | "vendor_invoice_number"
  | "vendor_invoice_date"
  | "status"
  | "total_paise"
  | "amount_paid_paise"
  | "payment_status"
  | "attachment_paths"
  | "created_at"
> & { vendor: { name: string } | null };

interface PhotoDraft {
  id: string;
  outlet_id: string;
  attachment_paths: string[];
  created_at: string;
  created_by: string | null;
}

/**
 * Drafts saved as "photo only" (a photo and nothing else yet), oldest first,
 * with a signed URL for the first page and the name of whoever saved them.
 */
async function loadPhotoDrafts(ctx: AppContext, outletIds: string[]) {
  const { data } = await ctx.supabase
    .from("purchase_bills")
    .select("id, outlet_id, attachment_paths, created_at, created_by")
    .eq("business_id", ctx.business.id)
    .in("outlet_id", outletIds)
    .eq("status", "draft")
    .is("vendor_id", null)
    .is("vendor_invoice_number", null)
    .eq("total_paise", 0)
    .order("created_at", { ascending: true })
    .limit(20);
  const drafts = ((data ?? []) as PhotoDraft[]).filter((d) => (d.attachment_paths ?? []).length > 0).slice(0, 12);
  if (drafts.length === 0) return { drafts, thumbs: {} as Record<string, string>, names: new Map<string, string>() };
  const userIds = [...new Set(drafts.map((d) => d.created_by).filter((v): v is string => !!v))];
  const [thumbs, profiles] = await Promise.all([
    signAttachments(ctx, drafts.map((d) => d.attachment_paths[0])),
    userIds.length > 0 ? ctx.supabase.from("profiles").select("id, full_name, email").in("id", userIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map<string, string>();
  for (const p of (profiles.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    names.set(p.id, p.full_name || p.email || "");
  }
  return { drafts, thumbs, names };
}

const STATUSES = ["draft", "posted", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "partial", "paid"];
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("purchases.view");
  const sp = await searchParams;
  const q = param(sp, "q");
  const status = param(sp, "status");
  const payment = param(sp, "payment");
  const outletId = param(sp, "outlet");
  const from = param(sp, "from");
  const to = param(sp, "to");
  const page = pageParam(sp);
  const canCreate = ctx.can("purchases.create");

  const outletIds = ctx.outlets.map((o) => o.id);
  const outletName = new Map(ctx.outlets.map((o) => [o.id, o.name]));
  const hasFilters = !!(q || status || payment || outletId || from || to);

  let rows: BillRow[] = [];
  let total = 0;
  let failed = false;

  // Managers see bill photos that staff saved for later at the top of the first page.
  const showPhotoDrafts = canCreate && ctx.can("purchases.post") && !hasFilters && page === 1 && outletIds.length > 0;
  const photoDraftsPromise = showPhotoDrafts ? loadPhotoDrafts(ctx, outletIds) : null;

  if (outletIds.length > 0) {
    let query = ctx.supabase
      .from("purchase_bills")
      .select(
        "id, outlet_id, vendor_invoice_number, vendor_invoice_date, status, total_paise, amount_paid_paise, payment_status, attachment_paths, created_at, vendor:vendors(name)",
        { count: "exact" },
      )
      .eq("business_id", ctx.business.id)
      .in("outlet_id", outletIds.includes(outletId) ? [outletId] : outletIds);

    if (STATUSES.includes(status)) query = query.eq("status", status);
    if (PAYMENT_STATUSES.includes(payment)) query = query.eq("payment_status", payment).eq("status", "posted");
    if (isDate(from)) query = query.gte("vendor_invoice_date", from);
    if (isDate(to)) query = query.lte("vendor_invoice_date", to);

    const term = ilikeTerm(q);
    if (term) {
      // Vendor names live in another table, so find matching vendors first.
      const { data: vendors } = await ctx.supabase
        .from("vendors")
        .select("id")
        .eq("business_id", ctx.business.id)
        .ilike("name", `%${term}%`)
        .limit(200);
      const vendorIds = ((vendors ?? []) as { id: string }[]).map((v) => v.id);
      query = query.or(
        [`vendor_invoice_number.ilike.%${term}%`, vendorIds.length ? `vendor_id.in.(${vendorIds.join(",")})` : null]
          .filter(Boolean)
          .join(","),
      );
    }

    const [start, end] = pageRange(page);
    const { data, count, error } = await query
      .order("vendor_invoice_date", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .range(start, end);
    failed = !!error;
    rows = (data ?? []) as unknown as BillRow[];
    total = count ?? 0;
  }

  const photoDrafts = photoDraftsPromise ? await photoDraftsPromise : null;

  const newButton = canCreate ? (
    <Button asChild className="h-12 px-4 text-base lg:h-8 lg:px-2.5 lg:text-sm">
      <Link href="/app/purchases/new">
        <Plus aria-hidden /> New purchase
      </Link>
    </Button>
  ) : null;
  const vendorLabel = (b: BillRow) => b.vendor?.name ?? (b.attachment_paths?.length ? "Bill photo, details pending" : "No supplier yet");

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Bills from your suppliers. Stock goes up when a bill is added to stock."
        actions={newButton ? <span className="hidden lg:inline-flex">{newButton}</span> : null}
      />

      {photoDrafts && photoDrafts.drafts.length > 0 ? (
        <section aria-labelledby="to-complete-heading" className="mb-6 rounded-xl border border-amber-200 bg-amber-50/70 p-3 sm:p-4">
          <h2 id="to-complete-heading" className="flex items-center gap-2 text-base font-semibold">
            To complete
            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">{photoDrafts.drafts.length}</span>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Bill photos saved for later. Fill in the details and add them to stock.</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {photoDrafts.drafts.map((d) => {
              const first = d.attachment_paths[0];
              const thumb = photoDrafts.thumbs[first];
              const pdf = /\.pdf$/i.test(first);
              const pages = d.attachment_paths.length;
              return (
                <li key={d.id} className="flex items-center gap-3 rounded-xl border bg-background p-3">
                  <span
                    className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted bg-cover bg-center"
                    style={thumb && !pdf ? { backgroundImage: `url("${thumb}")` } : undefined}
                    aria-hidden
                  >
                    {pdf ? <FileText className="size-6 text-muted-foreground" /> : thumb ? null : <ImageIcon className="size-6 text-muted-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium">
                      {pages === 1 ? "1 page" : `${pages} pages`}
                      {ctx.outlets.length > 1 ? <span className="font-normal text-muted-foreground"> · {outletName.get(d.outlet_id) ?? ""}</span> : null}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      By {(d.created_by && photoDrafts.names.get(d.created_by)) || "a team member"}
                    </span>
                    <span className="tabular block truncate text-sm text-muted-foreground">{formatDateTime(d.created_at)}</span>
                  </span>
                  <Button asChild className="h-12 shrink-0 px-4 text-base">
                    <Link href={`/app/purchases/${d.id}/edit`}>Complete</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search supplier or bill number" />
        <FilterSelect
          param="status"
          label="Status"
          options={[
            { value: "", label: "All statuses" },
            { value: "draft", label: "Draft" },
            { value: "posted", label: "Posted" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <FilterSelect
          param="payment"
          label="Payment status"
          options={[
            { value: "", label: "Any payment" },
            { value: "unpaid", label: "Unpaid" },
            { value: "partial", label: "Part paid" },
            { value: "paid", label: "Paid" },
          ]}
        />
        {ctx.outlets.length > 1 ? (
          <FilterSelect
            param="outlet"
            label="Outlet"
            options={[{ value: "", label: "All outlets" }, ...ctx.outlets.map((o) => ({ value: o.id, label: o.name }))]}
          />
        ) : null}
        <div className="flex items-center gap-1.5">
          <FilterDate param="from" label="Bill date from" />
          <span className="text-xs text-muted-foreground">to</span>
          <FilterDate param="to" label="Bill date to" />
        </div>
      </div>

      {failed ? (
        <EmptyState icon={ShoppingBag} title="Could not load purchase bills" description="Please refresh the page to try again." />
      ) : rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={ShoppingBag}
            title="No purchase bills match"
            description="Try a different search or clear the filters."
            action={
              <Button variant="outline" asChild>
                <Link href="/app/purchases">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ShoppingBag}
            title="No purchase bills yet"
            description="Enter a supplier's bill, or just take a photo of it now and fill in the details later."
            action={newButton}
          />
        )
      ) : (
        <>
          {/* Phones and tablets: one card per bill. */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {rows.map((b) => (
              <li key={b.id}>
                <Link href={`/app/purchases/${b.id}`} className="block rounded-xl border p-3 hover:bg-muted/40 active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-base font-semibold">{vendorLabel(b)}</span>
                    <span className="tabular shrink-0 text-base font-semibold">{formatINR(b.total_paise)}</span>
                  </span>
                  <span className="tabular mt-0.5 block truncate text-sm text-muted-foreground">
                    {[
                      b.vendor_invoice_number ? `Bill ${b.vendor_invoice_number}` : "No bill number",
                      b.vendor_invoice_date ? formatDate(b.vendor_invoice_date) : "No date",
                      ctx.outlets.length > 1 ? outletName.get(b.outlet_id) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={b.status} />
                    {b.status === "posted" ? <StatusBadge status={b.payment_status} /> : null}
                    {b.status === "posted" && b.payment_status === "partial" ? (
                      <span className="tabular text-xs text-muted-foreground">Paid {formatINR(b.amount_paid_paise)}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border lg:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Supplier</th>
                  <th scope="col" className="px-3 py-2 font-medium">Bill no.</th>
                  <th scope="col" className="px-3 py-2 font-medium">Outlet</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Paid</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/40">
                    <td className="tabular px-3 py-2 whitespace-nowrap">
                      {b.vendor_invoice_date ? formatDate(b.vendor_invoice_date) : <span className="text-muted-foreground">Not set</span>}
                    </td>
                    <td className="max-w-56 truncate px-3 py-2">
                      <Link href={`/app/purchases/${b.id}`} className="font-medium hover:underline">
                        {vendorLabel(b)}
                      </Link>
                    </td>
                    <td className="tabular px-3 py-2">{b.vendor_invoice_number ?? <span className="text-muted-foreground">Not set</span>}</td>
                    <td className="px-3 py-2">{outletName.get(b.outlet_id) ?? ""}</td>
                    <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatINR(b.total_paise)}</td>
                    <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                      {b.status === "posted" ? formatINR(b.amount_paid_paise) : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-2">
                      {b.status === "posted" ? <StatusBadge status={b.payment_status} /> : <span className="text-muted-foreground">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
        </>
      )}

      {canCreate ? (
        <>
          {/* Room so the floating button never hides the last bill. */}
          <div className="h-16 lg:hidden" aria-hidden />
          <Link
            href="/app/purchases/new"
            className="no-print fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 inline-flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-lg outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
          >
            <Plus className="size-5" aria-hidden /> New purchase
          </Link>
        </>
      ) : null}
    </>
  );
}
