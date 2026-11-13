import Link from "next/link";
import { Plus, ShoppingBag } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterDate, FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDate } from "@/lib/dates";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
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

  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/app/purchases/new">
        <Plus aria-hidden /> New purchase bill
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Purchases" description="Bills from your vendors. Posting a bill adds its items to stock." actions={newButton} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search vendor or bill number" />
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
            description="Enter a vendor's bill, or just attach a photo of it now and fill in the details later."
            action={newButton}
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Vendor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Vendor bill no.</th>
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
                        {b.vendor?.name ?? (b.attachment_paths?.length ? "Bill photo, details pending" : "No vendor yet")}
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
    </>
  );
}
