import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban } from "lucide-react";
import { z } from "zod";
import { DeliveryStatus } from "@/components/invoice/delivery-status";
import { SalePhotos } from "@/components/sales/sale-photos";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePage } from "@/lib/auth/context";
import { formatDate, formatDateTime, istDateString } from "@/lib/dates";
import { DOCUMENT_TITLES, displayHsn, formatMobile, formatRate, stateLabel, summariseByRate } from "@/lib/gst";
import { formatINR, formatQty } from "@/lib/money";
import type { CreditNote, Outlet, SalesInvoice, SalesInvoiceItem, SalesPayment } from "@/lib/types/db";
import { SOURCE_LABELS, PAYMENT_MODE_LABELS } from "../labels";
import { InvoiceActions } from "./invoice-actions";

export const metadata = { title: "Bill" };

type CreditNoteRow = Pick<CreditNote, "id" | "credit_note_number" | "credit_note_date" | "total_paise" | "reason">;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function cancelRuleText(windowDays: number | null): string {
  if (windowDays === null) return "Your business allows a bill to be cancelled at any time.";
  if (windowDays === 0) return "Your business allows a bill to be cancelled only on the day it was made. After that, issue a credit note.";
  return `Your business allows a bill to be cancelled within ${windowDays} ${windowDays === 1 ? "day" : "days"} of its date. After that, issue a credit note.`;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="grid gap-0.5 text-sm">{children}</div>
    </section>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-6 border-t pt-2 text-base font-semibold" : "flex justify-between gap-6 text-sm"}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage(["sales.view_all", "sales.view_own"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { data: invoiceRow, error } = await ctx.supabase
    .from("sales_invoices")
    .select("*")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the bill: ${error.message}`);
  // RLS hides bills from other outlets and, for view_own, bills made by someone else.
  if (!invoiceRow) notFound();
  const invoice = invoiceRow as SalesInvoice;

  const [itemsResult, paymentsResult, notesResult] = await Promise.all([
    ctx.supabase.from("sales_invoice_items").select("*").eq("invoice_id", id).order("line_no", { ascending: true }),
    ctx.supabase
      .from("sales_payments")
      .select("id, invoice_id, mode, amount_paise, reference, is_collection, received_on, created_at")
      .eq("invoice_id", id)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("credit_notes")
      .select("id, credit_note_number, credit_note_date, total_paise, reason")
      .eq("invoice_id", id)
      .eq("business_id", ctx.business.id)
      .order("created_at", { ascending: true }),
  ]);
  const items = (itemsResult.data ?? []) as SalesInvoiceItem[];
  const payments = (paymentsResult.data ?? []) as SalesPayment[];
  const creditNotes = (notesResult.data ?? []) as CreditNoteRow[];

  const peopleIds = [...new Set([invoice.created_by, invoice.cancelled_by].filter((v): v is string => !!v))];
  const { data: people } = peopleIds.length
    ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", peopleIds)
    : { data: [] };
  const nameOf = (userId: string | null) => {
    const p = ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).find((x) => x.id === userId);
    return p ? p.full_name || p.email || "Staff" : "Staff";
  };

  const outlet: Outlet | undefined = ctx.outlets.find((o) => o.id === invoice.outlet_id);
  const business = ctx.business;
  const cancelled = invoice.status === "cancelled";
  const taxed = invoice.document_type === "tax_invoice";
  const rateSummary = taxed
    ? summariseByRate(
        items.map((i) => ({
          gstRate: String(i.gst_rate),
          taxablePaise: i.taxable_paise,
          cgstPaise: i.cgst_paise,
          sgstPaise: i.sgst_paise,
          igstPaise: i.igst_paise,
          cessPaise: i.cess_paise,
        })),
      )
    : [];
  const returnedTotal = creditNotes.reduce((sum, n) => sum + n.total_paise, 0);

  const windowDays = business.cancel_window_days;
  const age = daysBetween(invoice.invoice_date, istDateString());
  const cancelBlocked =
    creditNotes.length > 0
      ? "This bill has a credit note against it, so it cannot be cancelled."
      : windowDays !== null && age > windowDays
        ? "This bill is too old to cancel. Issue a credit note instead."
        : null;

  const sellerAddress = [outlet?.address_line1, outlet?.address_line2, outlet?.city, outlet?.pincode].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        backHref="/app/sales"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{invoice.invoice_number}</span>
            <StatusBadge status={invoice.status} />
            {!cancelled && invoice.amount_due_paise > 0 ? <StatusBadge tone="amber" label={`${formatINR(invoice.amount_due_paise)} due`} /> : null}
          </span>
        }
        description={`${DOCUMENT_TITLES[invoice.document_type]} · ${formatDate(invoice.invoice_date)} · ${invoice.supply_type.toUpperCase()} · ${SOURCE_LABELS[invoice.source] ?? invoice.source}`}
      />

      {cancelled ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
          <Ban className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 text-sm">
            <p className="text-base font-semibold tracking-wide">CANCELLED</p>
            <p>
              Cancelled by {nameOf(invoice.cancelled_by)}
              {invoice.cancelled_at ? ` on ${formatDateTime(invoice.cancelled_at)}` : ""}.
            </p>
            <p className="mt-1">Reason: {invoice.cancel_reason || "Not given"}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-4">
        <InvoiceActions
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoice_number}
          cancelled={cancelled}
          amountDuePaise={invoice.amount_due_paise}
          publicToken={invoice.public_token}
          publicLinkOff={!!invoice.public_token_revoked_at}
          printFormat={business.default_print_format}
          can={{
            recordPayment: ctx.can("sales.create") && (ctx.can("sales.view_all") || invoice.created_by === ctx.user.id),
            cancel: ctx.can("sales.cancel"),
            creditNote: ctx.can("sales.credit_note"),
            shipment: ctx.can("shipments.create"),
            managePublicLink: ctx.can("settings.manage"),
          }}
          cancelRule={cancelRuleText(windowDays)}
          cancelBlocked={cancelBlocked}
        />
        {invoice.public_token_revoked_at ? (
          <p className="mt-2 text-xs text-muted-foreground">The public link for this bill is switched off.</p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Block title="Sold by">
          <p className="font-medium">{business.trade_name || business.legal_name}</p>
          {outlet ? <p>{outlet.name}</p> : null}
          {sellerAddress ? <p className="text-muted-foreground">{sellerAddress}</p> : null}
          {invoice.seller_gstin ? <p className="tabular">GSTIN: {invoice.seller_gstin}</p> : null}
          <p className="text-muted-foreground">State: {stateLabel(invoice.seller_state_code)}</p>
        </Block>
        <Block title="Billed to">
          <p className="font-medium">{invoice.customer_name || "Walk-in customer"}</p>
          {invoice.customer_phone ? <p className="tabular">{formatMobile(invoice.customer_phone)}</p> : null}
          {invoice.customer_email ? <p className="truncate">{invoice.customer_email}</p> : null}
          {invoice.customer_gstin ? <p className="tabular">GSTIN: {invoice.customer_gstin}</p> : null}
          {invoice.customer_address || invoice.customer_pincode ? (
            <p className="text-muted-foreground">{[invoice.customer_address, invoice.customer_pincode].filter(Boolean).join(", ")}</p>
          ) : null}
          {invoice.customer_state_code ? <p className="text-muted-foreground">State: {stateLabel(invoice.customer_state_code)}</p> : null}
        </Block>
        <Block title="Bill details">
          <p>
            Place of supply: <span className="font-medium">{stateLabel(invoice.place_of_supply_state)}</span>
          </p>
          {taxed ? <p className="text-muted-foreground">{invoice.is_inter_state ? "Another state: IGST" : "Same state: CGST + SGST"}</p> : null}
          {invoice.pos_override_reason ? <p className="text-muted-foreground">Place of supply changed by the cashier: {invoice.pos_override_reason}</p> : null}
          <p className="text-muted-foreground">Reverse charge: {invoice.reverse_charge ? "Yes" : "No"}</p>
          <p className="text-muted-foreground">
            Billed by {nameOf(invoice.created_by)} on {formatDateTime(invoice.created_at)}
          </p>
          {invoice.notes ? <p>Note: {invoice.notes}</p> : null}
        </Block>
      </div>

      <section className="mt-4" aria-label="Items">
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                {taxed ? <TableHead className="text-right">GST</TableHead> : null}
                {taxed ? <TableHead className="text-right">Tax</TableHead> : null}
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="tabular text-muted-foreground">{item.line_no}</TableCell>
                  <TableCell className="min-w-40">
                    {item.description}
                    {item.product_id === null ? (
                      <span className="ml-2 inline-block align-middle">
                        <StatusBadge tone="indigo" label="Not in product list" />
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular">{displayHsn(item.hsn_code, business.hsn_digits) || "-"}</TableCell>
                  <TableCell className="tabular text-right whitespace-nowrap">
                    {formatQty(item.quantity)} <span className="text-xs text-muted-foreground">{item.unit_code}</span>
                  </TableCell>
                  <TableCell className="tabular text-right whitespace-nowrap">
                    {formatINR(item.unit_price_paise, { symbol: false })}
                    {taxed ? <span className="block text-xs text-muted-foreground">{item.price_includes_tax ? "incl. tax" : "plus tax"}</span> : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{item.discount_paise > 0 ? formatINR(item.discount_paise, { symbol: false }) : "-"}</TableCell>
                  <TableCell className="tabular text-right">{formatINR(item.taxable_paise, { symbol: false })}</TableCell>
                  {taxed ? <TableCell className="tabular text-right">{formatRate(item.gst_rate)}</TableCell> : null}
                  {taxed ? (
                    <TableCell className="tabular text-right">
                      {formatINR(item.cgst_paise + item.sgst_paise + item.igst_paise + item.cess_paise, { symbol: false })}
                    </TableCell>
                  ) : null}
                  <TableCell className="tabular text-right font-medium">{formatINR(item.total_paise, { symbol: false })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-4">
          {taxed && rateSummary.length > 0 ? (
            <section className="rounded-xl border" aria-label="Tax by rate">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GST rate</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      {invoice.is_inter_state ? (
                        <TableHead className="text-right">IGST</TableHead>
                      ) : (
                        <>
                          <TableHead className="text-right">CGST</TableHead>
                          <TableHead className="text-right">SGST</TableHead>
                        </>
                      )}
                      <TableHead className="text-right">Cess</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rateSummary.map((r) => (
                      <TableRow key={r.gstRate}>
                        <TableCell className="tabular">{formatRate(r.gstRate)}</TableCell>
                        <TableCell className="tabular text-right">{formatINR(r.taxablePaise, { symbol: false })}</TableCell>
                        {invoice.is_inter_state ? (
                          <TableCell className="tabular text-right">{formatINR(r.igstPaise, { symbol: false })}</TableCell>
                        ) : (
                          <>
                            <TableCell className="tabular text-right">{formatINR(r.cgstPaise, { symbol: false })}</TableCell>
                            <TableCell className="tabular text-right">{formatINR(r.sgstPaise, { symbol: false })}</TableCell>
                          </>
                        )}
                        <TableCell className="tabular text-right">{formatINR(r.cessPaise, { symbol: false })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border" aria-label="Payments">
            <h2 className="border-b px-4 py-2.5 text-sm font-medium">Payments</h2>
            {payments.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">No payments on this bill.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="tabular whitespace-nowrap">{formatDate(p.received_on)}</TableCell>
                        <TableCell>
                          {PAYMENT_MODE_LABELS[p.mode] ?? p.mode}
                          {p.is_collection ? <span className="block text-xs text-muted-foreground">Collected later</span> : null}
                        </TableCell>
                        <TableCell className="max-w-40 truncate">{p.reference || "-"}</TableCell>
                        <TableCell className="tabular text-right">{formatINR(p.amount_paise)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {invoice.amount_due_paise > 0 && !cancelled ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={3}>Still due from the customer</TableCell>
                        <TableCell className="tabular text-right font-semibold text-destructive">{formatINR(invoice.amount_due_paise)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            )}
          </section>

          {creditNotes.length > 0 ? (
            <section className="rounded-xl border" aria-label="Credit notes">
              <h2 className="border-b px-4 py-2.5 text-sm font-medium">Credit notes against this bill</h2>
              <ul className="divide-y">
                {creditNotes.map((n) => (
                  <li key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/sales/credit-notes/${n.id}`} className="tabular font-medium text-primary underline-offset-4 hover:underline">
                        {n.credit_note_number}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(n.credit_note_date)} · {n.reason}
                      </p>
                    </div>
                    <span className="tabular shrink-0">{formatINR(n.total_paise)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <section className="content-start rounded-xl border p-4" aria-label="Totals">
          <dl className="grid gap-1.5">
            <TotalRow label="Subtotal" value={formatINR(invoice.subtotal_paise)} />
            {invoice.discount_paise > 0 ? <TotalRow label="Discount" value={`− ${formatINR(invoice.discount_paise)}`} /> : null}
            {taxed ? (
              <>
                <TotalRow label="Taxable value" value={formatINR(invoice.taxable_paise)} />
                {invoice.is_inter_state ? (
                  <TotalRow label="IGST" value={formatINR(invoice.igst_paise)} />
                ) : (
                  <>
                    <TotalRow label="CGST" value={formatINR(invoice.cgst_paise)} />
                    <TotalRow label="SGST" value={formatINR(invoice.sgst_paise)} />
                  </>
                )}
                {invoice.cess_paise > 0 ? <TotalRow label="Cess" value={formatINR(invoice.cess_paise)} /> : null}
              </>
            ) : null}
            {invoice.round_off_paise !== 0 ? <TotalRow label="Round off" value={formatINR(invoice.round_off_paise)} /> : null}
            <TotalRow label="Total" value={formatINR(invoice.total_paise)} strong />
            {returnedTotal > 0 ? <TotalRow label="Returned (credit notes)" value={`− ${formatINR(returnedTotal)}`} /> : null}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">{invoice.amount_in_words}</p>
        </section>
      </div>

      <div className="mt-4">
        <SalePhotos ctx={ctx} invoiceId={invoice.id} cancelled={cancelled} />
      </div>

      <div className="mt-4">
        <DeliveryStatus invoiceId={invoice.id} />
      </div>
    </>
  );
}
