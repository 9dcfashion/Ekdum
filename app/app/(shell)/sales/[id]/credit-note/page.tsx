import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, PackageCheck } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDate } from "@/lib/dates";
import { Decimal } from "@/lib/money";
import type { SalesInvoice, SalesInvoiceItem } from "@/lib/types/db";
import { CreditNoteForm, type ReturnLine } from "./credit-note-form";

export const metadata = { title: "Issue credit note" };

export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("sales.credit_note");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { data: invoiceRow } = await ctx.supabase
    .from("sales_invoices")
    .select("id, invoice_number, invoice_date, customer_name, status, amount_due_paise, total_paise")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!invoiceRow) notFound();
  const invoice = invoiceRow as Pick<SalesInvoice, "id" | "invoice_number" | "invoice_date" | "customer_name" | "status" | "amount_due_paise" | "total_paise">;
  const backHref = `/app/sales/${invoice.id}`;

  const header = (
    <PageHeader
      backHref={backHref}
      title={`Credit note for ${invoice.invoice_number}`}
      description={`Bill dated ${formatDate(invoice.invoice_date)} · ${invoice.customer_name || "Walk-in customer"}`}
    />
  );

  if (invoice.status === "cancelled") {
    return (
      <>
        {header}
        <EmptyState
          icon={Ban}
          title="This bill is cancelled"
          description="A cancelled bill has already been reversed in full, so there is nothing to return against it."
          action={
            <Button variant="outline" asChild>
              <Link href={backHref}>Back to the bill</Link>
            </Button>
          }
        />
      </>
    );
  }

  const { data: itemRows, error } = await ctx.supabase
    .from("sales_invoice_items")
    .select("id, line_no, description, quantity, unit_code, unit_price_paise, total_paise")
    .eq("invoice_id", id)
    .order("line_no", { ascending: true });
  if (error) throw new Error(`Could not load the bill items: ${error.message}`);
  const items = (itemRows ?? []) as Array<Pick<SalesInvoiceItem, "id" | "line_no" | "description" | "quantity" | "unit_code" | "unit_price_paise" | "total_paise">>;

  const [{ data: returnedRows }, { data: unitRows }] = await Promise.all([
    items.length
      ? ctx.supabase
          .from("credit_note_items")
          .select("invoice_item_id, quantity")
          .in(
            "invoice_item_id",
            items.map((i) => i.id),
          )
      : Promise.resolve({ data: [] }),
    ctx.supabase.from("units").select("code, allow_decimal"),
  ]);

  const returned = new Map<string, Decimal>();
  for (const row of (returnedRows ?? []) as Array<{ invoice_item_id: string; quantity: number }>) {
    returned.set(row.invoice_item_id, (returned.get(row.invoice_item_id) ?? new Decimal(0)).plus(row.quantity));
  }
  const decimalUnits = new Set(((unitRows ?? []) as Array<{ code: string; allow_decimal: boolean }>).filter((u) => u.allow_decimal).map((u) => u.code));

  const lines: ReturnLine[] = items.map((item) => {
    const sold = new Decimal(item.quantity);
    const back = returned.get(item.id) ?? new Decimal(0);
    const remaining = Decimal.max(sold.minus(back), 0);
    return {
      id: item.id,
      lineNo: item.line_no,
      description: item.description,
      unitCode: item.unit_code,
      // A line sold as 0.5 KGS must be returnable as 0.5 even if the unit list changed since.
      allowDecimal: decimalUnits.has(item.unit_code) || !sold.isInteger() || !remaining.isInteger(),
      sold: sold.toFixed(),
      returned: back.toFixed(),
      remaining: remaining.toFixed(),
      totalPaise: item.total_paise,
    };
  });

  if (lines.every((l) => l.remaining === "0")) {
    return (
      <>
        {header}
        <EmptyState
          icon={PackageCheck}
          title="Everything on this bill has already been returned"
          description="There are no items left to issue a credit note for."
          action={
            <Button variant="outline" asChild>
              <Link href={backHref}>Back to the bill</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {header}
      <CreditNoteForm invoiceId={invoice.id} amountDuePaise={invoice.amount_due_paise} lines={lines} />
    </>
  );
}
