import Link from "next/link";
import { notFound } from "next/navigation";
import { ReceiptText } from "lucide-react";
import { PartyTabs } from "@/components/parties/party-tabs";
import { StatCard } from "@/components/parties/stat-card";
import { VendorForm } from "@/components/parties/vendor-form";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { formatDate } from "@/lib/dates";
import { PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { formatINR } from "@/lib/money";
import type { Vendor } from "@/lib/types/db";
import { uuid } from "@/lib/validation/common";
import { deleteVendorAction, saveVendorAction } from "../actions";

export const metadata = { title: "Vendor" };

interface BillRow {
  id: string;
  vendor_invoice_number: string | null;
  vendor_invoice_date: string | null;
  created_at: string;
  total_paise: number;
  amount_paid_paise: number;
  status: "draft" | "posted" | "cancelled";
  payment_status: "unpaid" | "partial" | "paid";
}

interface PayableRow {
  vendor_id: string;
  bill_count: number;
  outstanding_paise: number;
}

export default async function VendorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requirePage(["vendors.manage", "purchases.view"]);
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const sp = await searchParams;
  const canSeeBills = ctx.can("purchases.view");
  const tab = canSeeBills && param(sp, "tab") !== "details" ? "bills" : "details";
  const page = pageParam(sp);
  const [from, to] = pageRange(page);

  const { data: vendorRow } = await ctx.supabase
    .from("vendors")
    .select("*")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!vendorRow) notFound();
  const vendor = vendorRow as Vendor;

  const [payablesResult, history] = await Promise.all([
    canSeeBills ? ctx.supabase.rpc("vendor_payables", { p_business_id: ctx.business.id }) : null,
    tab === "bills"
      ? ctx.supabase
          .from("purchase_bills")
          .select(
            "id, vendor_invoice_number, vendor_invoice_date, created_at, total_paise, amount_paid_paise, status, payment_status",
            { count: "exact" },
          )
          .eq("business_id", ctx.business.id)
          .eq("vendor_id", vendor.id)
          .order("vendor_invoice_date", { ascending: false, nullsFirst: true })
          .order("created_at", { ascending: false })
          .range(from, to)
      : null,
  ]);
  const payable = ((payablesResult?.data ?? []) as PayableRow[]).find((row) => row.vendor_id === vendor.id);
  const outstanding = Number(payable?.outstanding_paise ?? 0);
  const unpaidBills = Number(payable?.bill_count ?? 0);
  const bills = (history?.data ?? []) as BillRow[];
  const billTotal = history?.count ?? 0;
  const base = `/app/vendors/${vendor.id}`;
  const subtitle = [vendor.gstin, vendor.phone].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{vendor.name}</span>
            {vendor.is_active ? null : <StatusBadge status="inactive" />}
          </span>
        }
        description={subtitle || undefined}
        backHref="/app/vendors"
      />

      {canSeeBills ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 sm:max-w-xl">
            <StatCard
              label="Outstanding payable"
              value={formatINR(outstanding)}
              tone={outstanding > 0 ? "warning" : "default"}
              hint={outstanding > 0 ? "Still to be paid on posted bills" : "Nothing to pay"}
            />
            <StatCard label="Unpaid bills" value={unpaidBills.toLocaleString("en-IN")} hint="Posted bills not fully paid" />
          </div>
          <PartyTabs
            active={tab}
            tabs={[
              { key: "bills", label: "Purchase history", href: base },
              { key: "details", label: "Details", href: `${base}?tab=details` },
            ]}
          />
        </>
      ) : null}

      {tab === "details" ? (
        <VendorForm
          key={vendor.id}
          vendor={vendor}
          canManage={ctx.can("vendors.manage")}
          saveAction={saveVendorAction}
          deleteAction={deleteVendorAction}
        />
      ) : history?.error ? (
        <EmptyState icon={ReceiptText} title="Bills could not be loaded" description="Please refresh the page to try again." />
      ) : bills.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={page > 1 ? "No more bills" : "No purchase bills yet"}
          description={
            page > 1
              ? "There are no bills on this page."
              : "Purchase bills entered for this vendor at the outlets you can access will show here."
          }
        />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor invoice no.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((bill) => (
                  <TableRow key={bill.id}>
                    <TableCell className="tabular whitespace-nowrap">
                      {formatDate(bill.vendor_invoice_date ?? bill.created_at)}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      <Link href={`/app/purchases/${bill.id}`} className="font-medium text-primary hover:underline">
                        {bill.vendor_invoice_number || "No number yet"}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">{formatINR(bill.total_paise)}</TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">{formatINR(bill.amount_paid_paise)}</TableCell>
                    <TableCell>
                      <StatusBadge status={bill.status} />
                    </TableCell>
                    <TableCell>
                      {bill.status === "posted" ? (
                        <StatusBadge status={bill.payment_status} />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={billTotal} />
        </>
      )}
    </>
  );
}
