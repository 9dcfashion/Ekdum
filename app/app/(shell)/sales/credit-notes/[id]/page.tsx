import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDate } from "@/lib/dates";
import { amountInWords, displayHsn, formatMobile, formatRate, stateLabel } from "@/lib/gst";
import { formatINR, formatQty } from "@/lib/money";
import type { CreditNote, CreditNoteItem, SalesInvoice } from "@/lib/types/db";
import { PAYMENT_MODE_LABELS } from "../../labels";
import { PrintButton } from "./print-button";

export const metadata = { title: "Credit note" };

type InvoiceRef = Pick<
  SalesInvoice,
  | "id"
  | "invoice_number"
  | "invoice_date"
  | "document_type"
  | "seller_state_code"
  | "place_of_supply_state"
  | "customer_name"
  | "customer_phone"
  | "customer_gstin"
  | "customer_address"
  | "customer_pincode"
  | "customer_state_code"
>;

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-6 border-t pt-1.5 text-base font-semibold" : "flex justify-between gap-6"}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

export default async function CreditNoteViewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage(["sales.view_all", "sales.view_own"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { data: noteRow, error } = await ctx.supabase.from("credit_notes").select("*").eq("id", id).eq("business_id", ctx.business.id).maybeSingle();
  if (error) throw new Error(`Could not load the credit note: ${error.message}`);
  if (!noteRow) notFound();
  const note = noteRow as CreditNote;

  const [itemsResult, invoiceResult, profileResult] = await Promise.all([
    ctx.supabase.from("credit_note_items").select("*").eq("credit_note_id", id).order("line_no", { ascending: true }),
    ctx.supabase
      .from("sales_invoices")
      .select(
        "id, invoice_number, invoice_date, document_type, seller_state_code, place_of_supply_state, customer_name, customer_phone, customer_gstin, customer_address, customer_pincode, customer_state_code",
      )
      .eq("id", note.invoice_id)
      .eq("business_id", ctx.business.id)
      .maybeSingle(),
    note.created_by
      ? ctx.supabase.from("profiles").select("id, full_name, email").eq("id", note.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const items = (itemsResult.data ?? []) as CreditNoteItem[];
  const invoice = invoiceResult.data as InvoiceRef | null;
  const issuer = profileResult.data as { full_name: string | null; email: string | null } | null;

  const business = ctx.business;
  const outlet = ctx.outlets.find((o) => o.id === note.outlet_id);
  const sellerAddress = [outlet?.address_line1, outlet?.address_line2, outlet?.city, outlet?.pincode].filter(Boolean).join(", ");
  const taxed = note.cgst_paise + note.sgst_paise + note.igst_paise + note.cess_paise > 0 || invoice?.document_type === "tax_invoice";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={invoice ? `/app/sales/${invoice.id}` : "/app/sales?tab=credit-notes"}
          className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden /> {invoice ? `Back to bill ${invoice.invoice_number}` : "Back to credit notes"}
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/app/sales?tab=credit-notes">All credit notes</Link>
          </Button>
          <PrintButton />
        </div>
      </div>

      <article className="rounded-xl border bg-background p-5 text-sm sm:p-8 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div className="min-w-0">
            <p className="text-lg font-semibold">{business.trade_name || business.legal_name}</p>
            {outlet ? <p>{outlet.name}</p> : null}
            {sellerAddress ? <p className="text-muted-foreground">{sellerAddress}</p> : null}
            {note.seller_gstin ? <p className="tabular">GSTIN: {note.seller_gstin}</p> : null}
            {invoice ? <p className="text-muted-foreground">State: {stateLabel(invoice.seller_state_code)}</p> : null}
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold tracking-tight">Credit Note</h1>
            <p className="tabular font-medium">{note.credit_note_number}</p>
            <p className="tabular text-muted-foreground">Date: {formatDate(note.credit_note_date)}</p>
          </div>
        </header>

        <section className="grid gap-4 border-b py-4 sm:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Issued to</h2>
            <p className="font-medium">{invoice?.customer_name || "Walk-in customer"}</p>
            {invoice?.customer_phone ? <p className="tabular">{formatMobile(invoice.customer_phone)}</p> : null}
            {invoice?.customer_gstin ? <p className="tabular">GSTIN: {invoice.customer_gstin}</p> : null}
            {invoice?.customer_address || invoice?.customer_pincode ? (
              <p className="text-muted-foreground">{[invoice.customer_address, invoice.customer_pincode].filter(Boolean).join(", ")}</p>
            ) : null}
            {invoice?.customer_state_code ? <p className="text-muted-foreground">State: {stateLabel(invoice.customer_state_code)}</p> : null}
          </div>
          <div>
            <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Against original bill</h2>
            {invoice ? (
              <>
                <p className="tabular font-medium">
                  <Link href={`/app/sales/${invoice.id}`} className="underline-offset-4 hover:underline print:no-underline">
                    {invoice.invoice_number}
                  </Link>
                </p>
                <p className="tabular text-muted-foreground">Dated {formatDate(invoice.invoice_date)}</p>
                <p className="text-muted-foreground">Place of supply: {stateLabel(invoice.place_of_supply_state)}</p>
              </>
            ) : (
              <p className="text-muted-foreground">The original bill is not available to you.</p>
            )}
            <p className="mt-1">Reason: {note.reason}</p>
          </div>
        </section>

        <div className="overflow-x-auto py-4 print:overflow-visible">
          <table className="w-full min-w-[34rem] border-collapse text-left print:min-w-0">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="w-8 py-1.5 pr-2 font-medium">#</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Item</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">HSN</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Qty</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Rate</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Taxable</th>
                {taxed ? <th scope="col" className="py-1.5 pr-2 text-right font-medium">GST</th> : null}
                {taxed ? <th scope="col" className="py-1.5 pr-2 text-right font-medium">Tax</th> : null}
                <th scope="col" className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b align-top">
                  <td className="tabular py-1.5 pr-2 text-muted-foreground">{item.line_no}</td>
                  <td className="py-1.5 pr-2">{item.description}</td>
                  <td className="tabular py-1.5 pr-2">{displayHsn(item.hsn_code, business.hsn_digits) || "-"}</td>
                  <td className="tabular py-1.5 pr-2 text-right whitespace-nowrap">
                    {formatQty(item.quantity)} {item.unit_code}
                  </td>
                  <td className="tabular py-1.5 pr-2 text-right">{formatINR(item.unit_price_paise, { symbol: false })}</td>
                  <td className="tabular py-1.5 pr-2 text-right">{formatINR(item.taxable_paise, { symbol: false })}</td>
                  {taxed ? <td className="tabular py-1.5 pr-2 text-right">{formatRate(item.gst_rate)}</td> : null}
                  {taxed ? (
                    <td className="tabular py-1.5 pr-2 text-right">
                      {formatINR(item.cgst_paise + item.sgst_paise + item.igst_paise + item.cess_paise, { symbol: false })}
                    </td>
                  ) : null}
                  <td className="tabular py-1.5 text-right font-medium">{formatINR(item.total_paise, { symbol: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="grid content-start gap-3">
            <div>
              <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">How the customer gets the value back</h2>
              <dl className="grid gap-1">
                {note.adjusted_against_due_paise > 0 ? (
                  <Line label="Set against the amount due on the bill" value={formatINR(note.adjusted_against_due_paise)} />
                ) : null}
                <Line
                  label={note.refund_paise > 0 && note.refund_mode ? `Refunded by ${(PAYMENT_MODE_LABELS[note.refund_mode as keyof typeof PAYMENT_MODE_LABELS] ?? note.refund_mode).toLowerCase()}` : "Refunded"}
                  value={formatINR(note.refund_paise)}
                />
              </dl>
            </div>
            <p className="text-muted-foreground">{note.restock ? "The returned items were put back into stock." : "The returned items were not put back into stock."}</p>
            <p>{amountInWords(note.total_paise)}</p>
          </div>
          <dl className="grid content-start gap-1">
            <Line label="Taxable value" value={formatINR(note.taxable_paise)} />
            {taxed ? (
              note.is_inter_state ? (
                <Line label="IGST" value={formatINR(note.igst_paise)} />
              ) : (
                <>
                  <Line label="CGST" value={formatINR(note.cgst_paise)} />
                  <Line label="SGST" value={formatINR(note.sgst_paise)} />
                </>
              )
            ) : null}
            {note.cess_paise > 0 ? <Line label="Cess" value={formatINR(note.cess_paise)} /> : null}
            {note.round_off_paise !== 0 ? <Line label="Round off" value={formatINR(note.round_off_paise)} /> : null}
            <Line label="Credit note total" value={formatINR(note.total_paise)} strong />
          </dl>
        </section>

        <footer className="mt-8 flex flex-wrap items-end justify-between gap-4 border-t pt-4 text-xs text-muted-foreground">
          <p>Issued by {issuer ? issuer.full_name || issuer.email || "Staff" : "Staff"}</p>
          <p className="pt-8 text-foreground">Authorised Signatory</p>
        </footer>
      </article>
    </div>
  );
}
