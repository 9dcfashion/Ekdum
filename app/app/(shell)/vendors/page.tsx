import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { stateName } from "@/lib/gst";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
import type { Vendor } from "@/lib/types/db";

export const metadata = { title: "Vendors" };

const STATUS_FILTERS = [
  { value: "", label: "All vendors" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface PayableRow {
  vendor_id: string;
  bill_count: number;
  outstanding_paise: number;
}

export default async function VendorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage(["vendors.manage", "purchases.view"]);
  const sp = await searchParams;
  const q = param(sp, "q");
  const status = param(sp, "status");
  const page = pageParam(sp);
  const [from, to] = pageRange(page);
  const canManage = ctx.can("vendors.manage");
  const showPayables = ctx.can("purchases.view");

  let query = ctx.supabase.from("vendors").select("*", { count: "exact" }).eq("business_id", ctx.business.id);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  const term = ilikeTerm(q);
  if (term) query = query.or(`name.ilike.*${term}*,gstin.ilike.*${term}*,phone.ilike.*${term}*`);

  const [{ data, count, error }, payablesResult] = await Promise.all([
    query.order("name", { ascending: true }).order("id").range(from, to),
    showPayables ? ctx.supabase.rpc("vendor_payables", { p_business_id: ctx.business.id }) : null,
  ]);
  if (error) throw new Error("Could not load vendors. Please try again.");
  const vendors = (data ?? []) as Vendor[];
  const total = count ?? 0;
  const payables = new Map<string, number>();
  for (const row of (payablesResult?.data ?? []) as PayableRow[]) payables.set(row.vendor_id, Number(row.outstanding_paise));
  const filtered = q !== "" || status !== "";

  const newButton = canManage ? (
    <Button asChild>
      <Link href="/app/vendors/new">
        <Plus aria-hidden /> New vendor
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Vendors" description="Suppliers you buy from, and what you still owe them." actions={newButton} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search name, GSTIN or phone" />
        <FilterSelect param="status" label="Filter by status" options={STATUS_FILTERS} />
      </div>

      {vendors.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Truck}
            title="No vendors match"
            description="Try a different name, GSTIN or phone number, or clear the filters."
            action={
              <Button variant="outline" asChild>
                <Link href="/app/vendors">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="No vendors yet"
            description={
              canManage
                ? "Add the suppliers you buy from so purchase bills and payables stay organised."
                : "Vendors added by the owner or manager will show here."
            }
            action={newButton}
          />
        )
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>State</TableHead>
                  {showPayables ? <TableHead className="text-right">Outstanding payable</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => {
                  const payable = payables.get(v.id) ?? 0;
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="max-w-64 font-medium">
                        <span className="flex items-center gap-2">
                          <Link href={`/app/vendors/${v.id}`} className="truncate hover:text-primary hover:underline">
                            {v.name}
                          </Link>
                          {v.is_active ? null : <StatusBadge status="inactive" />}
                        </span>
                      </TableCell>
                      <TableCell className="tabular">{v.gstin ?? <Dash />}</TableCell>
                      <TableCell className="tabular whitespace-nowrap">{v.phone ?? <Dash />}</TableCell>
                      <TableCell className="whitespace-nowrap">{stateName(v.state_code) || <Dash />}</TableCell>
                      {showPayables ? (
                        <TableCell className="tabular text-right whitespace-nowrap">
                          {payable > 0 ? <span className="font-medium text-amber-700">{formatINR(payable)}</span> : <Dash />}
                        </TableCell>
                      ) : null}
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

function Dash() {
  return <span className="text-muted-foreground">-</span>;
}
