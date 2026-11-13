import Link from "next/link";
import { notFound } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { CustomerForm } from "@/components/parties/customer-form";
import { PartyTabs } from "@/components/parties/party-tabs";
import { StatCard } from "@/components/parties/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { formatDate } from "@/lib/dates";
import { formatMobile } from "@/lib/gst";
import { PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
import type { Customer } from "@/lib/types/db";
import { uuid } from "@/lib/validation/common";
import { deleteCustomerAction, saveCustomerAction } from "../actions";
import { loadCustomerTotals } from "../queries";

export const metadata = { title: "Customer" };

interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_paise: number;
  amount_due_paise: number;
  status: "posted" | "cancelled";
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requirePage("customers.view");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const sp = await searchParams;
  const tab = param(sp, "tab") === "details" ? "details" : "bills";
  const page = pageParam(sp);
  const [from, to] = pageRange(page);

  const { data: customerRow } = await ctx.supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!customerRow) notFound();
  const customer = customerRow as Customer;

  const [totals, history] = await Promise.all([
    loadCustomerTotals(ctx, customer.id),
    tab === "bills"
      ? ctx.supabase
          .from("sales_invoices")
          .select("id, invoice_number, invoice_date, total_paise, amount_due_paise, status", { count: "exact" })
          .eq("business_id", ctx.business.id)
          .eq("customer_id", customer.id)
          .order("invoice_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to)
      : null,
  ]);
  const invoices = (history?.data ?? []) as InvoiceRow[];
  const invoiceTotal = history?.count ?? 0;
  const base = `/app/customers/${customer.id}`;
  const subtitle = [customer.phone ? formatMobile(customer.phone) : null, customer.gstin].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title={customer.name} description={subtitle || undefined} backHref="/app/customers" />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total spent"
          value={formatINR(totals.spentPaise)}
          hint={totals.truncated ? "Based on the first 20,000 bills" : "Across posted bills"}
        />
        <StatCard label="Bills" value={totals.truncated ? `${totals.billCount.toLocaleString("en-IN")}+` : totals.billCount.toLocaleString("en-IN")} />
        <StatCard
          label="Outstanding due"
          value={formatINR(totals.duePaise)}
          tone={totals.duePaise > 0 ? "warning" : "default"}
          hint={totals.duePaise > 0 ? "Still to be collected" : "Nothing to collect"}
        />
      </div>

      <PartyTabs
        active={tab}
        tabs={[
          { key: "bills", label: "Purchase history", href: base },
          { key: "details", label: "Details", href: `${base}?tab=details` },
        ]}
      />

      {tab === "details" ? (
        <CustomerForm
          key={customer.id}
          customer={customer}
          canManage={ctx.can("customers.manage")}
          saveAction={saveCustomerAction}
          deleteAction={deleteCustomerAction}
        />
      ) : history?.error ? (
        <EmptyState icon={ReceiptText} title="Bills could not be loaded" description="Please refresh the page to try again." />
      ) : invoices.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={page > 1 ? "No more bills" : "No bills yet"}
          description={
            page > 1
              ? "There are no bills on this page."
              : "Bills made for this customer will show here. Pick the customer while billing to link a sale to them."
          }
        />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Bill no.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="tabular whitespace-nowrap">{formatDate(inv.invoice_date)}</TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      <Link href={`/app/sales/${inv.id}`} className="font-medium text-primary hover:underline">
                        {inv.invoice_number}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">{formatINR(inv.total_paise)}</TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">
                      {inv.amount_due_paise > 0 ? (
                        <span className="font-medium text-amber-700">{formatINR(inv.amount_due_paise)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={inv.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={invoiceTotal} />
        </>
      )}
    </>
  );
}
