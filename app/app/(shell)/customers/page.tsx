import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { formatMobile, stateName } from "@/lib/gst";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
import type { Customer } from "@/lib/types/db";
import { loadCustomerDues } from "./queries";

export const metadata = { title: "Customers" };

const FILTERS = [
  { value: "", label: "All customers" },
  { value: "b2b", label: "Business (has GSTIN)" },
  { value: "dues", label: "With dues" },
  { value: "whatsapp", label: "WhatsApp opted in" },
];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("customers.view");
  const sp = await searchParams;
  const q = param(sp, "q");
  const filter = param(sp, "filter");
  const page = pageParam(sp);
  const [from, to] = pageRange(page);
  const canManage = ctx.can("customers.manage");

  // "With dues" = customers having at least one posted bill with money still to collect.
  // The inner join keeps only those customers; the bills themselves are summed below.
  const withDues = filter === "dues";
  let query = ctx.supabase
    .from("customers")
    .select(withDues ? "*, sales_invoices!inner(id)" : "*", { count: "exact" })
    .eq("business_id", ctx.business.id);
  if (withDues) query = query.gt("sales_invoices.amount_due_paise", 0).eq("sales_invoices.status", "posted");
  if (filter === "b2b") query = query.not("gstin", "is", null);
  if (filter === "whatsapp") query = query.eq("whatsapp_opt_in", true);

  const term = ilikeTerm(q);
  if (term) {
    // Phones are stored as +91XXXXXXXXXX: match on digits so "98765 43210" finds the customer.
    const digits = q.replace(/\D/g, "");
    const phoneTerm = /^[\d\s+()-]+$/.test(q) && digits.length >= 3 ? digits : term;
    query = query.or(`name.ilike.*${term}*,phone.ilike.*${phoneTerm}*,gstin.ilike.*${term}*`);
  }

  const { data, count, error } = await query.order("name", { ascending: true }).order("id").range(from, to);
  if (error) throw new Error("Could not load customers. Please try again.");
  const customers = (data ?? []) as unknown as Customer[];
  const total = count ?? 0;
  const dues = await loadCustomerDues(ctx, customers.map((c) => c.id));
  const filtered = q !== "" || filter !== "";

  const newButton = canManage ? (
    <Button asChild>
      <Link href="/app/customers/new">
        <Plus aria-hidden /> New customer
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader title="Customers" description="People and businesses you bill, with their dues and past bills." actions={newButton} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search name, phone or GSTIN" />
        <FilterSelect param="filter" label="Filter customers" options={FILTERS} />
      </div>

      {customers.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Users}
            title="No customers match"
            description="Try a different name, phone number or GSTIN, or clear the filters."
            action={
              <Button variant="outline" asChild>
                <Link href="/app/customers">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="Customers are saved when you add them here or enter a phone number while billing."
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
                  <TableHead>Phone</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>City / State</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead className="text-right">Outstanding due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const due = dues.get(c.id) ?? 0;
                  const place = [c.city, stateName(c.state_code)].filter(Boolean).join(", ");
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-56 font-medium">
                        <Link href={`/app/customers/${c.id}`} className="block truncate hover:text-primary hover:underline">
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap">{c.phone ? formatMobile(c.phone) : <Dash />}</TableCell>
                      <TableCell className="tabular">{c.gstin ?? <Dash />}</TableCell>
                      <TableCell className="whitespace-nowrap">{place || <Dash />}</TableCell>
                      <TableCell>
                        {c.whatsapp_opt_in ? <StatusBadge label="Opted in" tone="green" /> : <Dash />}
                      </TableCell>
                      <TableCell className="tabular text-right whitespace-nowrap">
                        {due > 0 ? <span className="font-medium text-amber-700">{formatINR(due)}</span> : <Dash />}
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

function Dash() {
  return <span className="text-muted-foreground">-</span>;
}
