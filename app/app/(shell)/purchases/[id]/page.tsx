import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { AttachmentTile } from "@/components/purchases/attachment-tile";
import {
  CancelBillDialog,
  DeleteDraftButton,
  DeletePaymentButton,
  PostBillButton,
  RecordPaymentDialog,
} from "@/components/purchases/bill-actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDate, formatDateTime, istDateString } from "@/lib/dates";
import { formatRate, stateLabel, summariseByRate } from "@/lib/gst";
import { movementLabel, signedQty } from "@/lib/inventory/ledger";
import { formatINR, formatQty } from "@/lib/money";
import { signAttachments } from "@/lib/purchases/server";
import type { PurchaseBill, PurchaseBillItem, PurchasePayment } from "@/lib/types/db";
import { uuid } from "@/lib/validation/common";
import { PURCHASE_PAYMENT_MODE_LABELS } from "@/lib/validation/purchases";

export const metadata = { title: "Purchase bill" };

type BillRow = PurchaseBill & {
  posted_by: string | null;
  cancelled_by: string | null;
  created_by: string | null;
  vendor: { id: string; name: string; gstin: string | null; state_code: string | null; phone: string | null } | null;
  outlet: { name: string } | null;
};
type PaymentRow = PurchasePayment & { created_by: string | null };
interface MovementRow {
  id: string;
  product_id: string;
  quantity_delta: number;
  movement_type: string;
  created_at: string;
  product: { name: string; unit_code: string } | null;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

const notSet = <span className="text-muted-foreground">Not set</span>;

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("purchases.view");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const { data: billRow } = await ctx.supabase
    .from("purchase_bills")
    .select("*, vendor:vendors(id, name, gstin, state_code, phone), outlet:outlets(name)")
    .eq("id", id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  const bill = billRow as BillRow | null;
  if (!bill) notFound();

  const canSeeStock = ctx.can("inventory.view");
  const [{ data: itemRows }, { data: paymentRows }, attachmentUrls, { data: movementRows }] = await Promise.all([
    ctx.supabase.from("purchase_bill_items").select("*").eq("purchase_bill_id", id).order("line_no"),
    ctx.supabase
      .from("purchase_payments")
      .select("*")
      .eq("purchase_bill_id", id)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false }),
    signAttachments(ctx, bill.attachment_paths),
    canSeeStock && bill.status !== "draft"
      ? ctx.supabase
          .from("stock_movements")
          .select("id, product_id, quantity_delta, movement_type, created_at, product:products(name, unit_code)")
          .eq("business_id", ctx.business.id)
          .eq("source_table", "purchase_bills")
          .eq("source_id", id)
          .order("created_at")
          .order("id")
      : Promise.resolve({ data: [] }),
  ]);
  const items = (itemRows ?? []) as PurchaseBillItem[];
  const payments = (paymentRows ?? []) as PaymentRow[];
  const movements = (movementRows ?? []) as unknown as MovementRow[];

  // created_by and friends point at auth.users, so names are fetched separately.
  const userIds = [...new Set([bill.created_by, bill.posted_by, bill.cancelled_by, ...payments.map((p) => p.created_by)].filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await ctx.supabase.from("profiles").select("id, full_name, email").in("id", userIds);
    for (const p of (profiles ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
      names.set(p.id, p.full_name || p.email || "");
    }
  }
  const who = (userId: string | null) => (userId ? names.get(userId) || "a team member" : "a team member");

  const outletName = bill.outlet?.name ?? ctx.outlets.find((o) => o.id === bill.outlet_id)?.name ?? "the outlet";
  const outstanding = Math.max(0, Number(bill.total_paise) - Number(bill.amount_paid_paise));
  const taxRows = summariseByRate(
    items.map((i) => ({
      gstRate: String(i.gst_rate),
      taxablePaise: Number(i.taxable_paise),
      cgstPaise: Number(i.cgst_paise),
      sgstPaise: Number(i.sgst_paise),
      igstPaise: Number(i.igst_paise),
      cessPaise: Number(i.cess_paise),
    })),
  );
  const hasCess = Number(bill.cess_paise) > 0;
  const canCreate = ctx.can("purchases.create");
  const canPost = ctx.can("purchases.post");
  const isDraft = bill.status === "draft";
  const isPosted = bill.status === "posted";
  const readyToPost = !!bill.vendor_id && !!bill.vendor_invoice_number && !!bill.vendor_invoice_date && items.length > 0;

  const actions = (
    <>
      {isDraft && canCreate ? (
        <Button variant="outline" asChild>
          <Link href={`/app/purchases/${bill.id}/edit`}>
            <Pencil aria-hidden /> {readyToPost ? "Edit" : "Complete"}
          </Link>
        </Button>
      ) : null}
      {isDraft && canCreate ? <DeleteDraftButton billId={bill.id} /> : null}
      {isDraft && canPost && readyToPost ? <PostBillButton billId={bill.id} outletName={outletName} /> : null}
      {isPosted && canPost ? <CancelBillDialog billId={bill.id} hasPayments={payments.length > 0} /> : null}
      {isPosted && canCreate && outstanding > 0 ? (
        <RecordPaymentDialog billId={bill.id} outstandingPaise={outstanding} today={istDateString()} />
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate">{bill.vendor?.name ?? "Purchase bill"}</span>
            <StatusBadge status={bill.status} />
            {isPosted ? <StatusBadge status={bill.payment_status} /> : null}
          </span>
        }
        description={
          isDraft
            ? "Draft. Nothing has been added to stock yet."
            : isPosted
              ? `Posted by ${who(bill.posted_by)} on ${formatDateTime(bill.posted_at)}`
              : `Cancelled by ${who(bill.cancelled_by)} on ${formatDateTime(bill.cancelled_at)}`
        }
        backHref="/app/purchases"
        actions={actions}
      />

      {isDraft && !readyToPost ? (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This draft cannot be added to stock yet. It still needs{" "}
          {[
            !bill.vendor_id ? "the supplier" : null,
            !bill.vendor_invoice_number ? "the bill number" : null,
            !bill.vendor_invoice_date ? "the bill date" : null,
            items.length === 0 ? "at least one item" : null,
          ]
            .filter(Boolean)
            .join(", ")}
          .{canCreate ? " Tap Complete to fill in the details from the bill photo." : ""}
        </p>
      ) : null}
      {bill.status === "cancelled" && bill.cancel_reason ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Reason for cancelling: {bill.cancel_reason}</p>
      ) : null}

      <div className="grid gap-5">
        <section className="rounded-xl border p-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Detail label="Supplier">
              {bill.vendor ? (
                <>
                  {bill.vendor.name}
                  {bill.vendor.gstin ? <span className="tabular block text-xs text-muted-foreground">GSTIN {bill.vendor.gstin}</span> : null}
                </>
              ) : (
                notSet
              )}
            </Detail>
            <Detail label="Bill number">{bill.vendor_invoice_number ? <span className="tabular">{bill.vendor_invoice_number}</span> : notSet}</Detail>
            <Detail label="Bill date">{bill.vendor_invoice_date ? <span className="tabular">{formatDate(bill.vendor_invoice_date)}</span> : notSet}</Detail>
            <Detail label="Received at">{outletName}</Detail>
            <Detail label="Place of supply">{bill.place_of_supply_state ? stateLabel(bill.place_of_supply_state) : notSet}</Detail>
            <Detail label="GST type">{bill.is_inter_state ? "IGST (supplier in another state)" : "CGST + SGST (same state)"}</Detail>
            <Detail label="Entered by">
              {who(bill.created_by)}
              <span className="tabular block text-xs text-muted-foreground">{formatDateTime(bill.created_at)}</span>
            </Detail>
            {bill.notes ? <Detail label="Notes">{bill.notes}</Detail> : null}
          </dl>
        </section>

        <section aria-labelledby="items-heading">
          <h2 id="items-heading" className="mb-2 text-sm font-semibold">
            Items
          </h2>
          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No items entered yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">#</th>
                    <th scope="col" className="px-3 py-2 font-medium">Item</th>
                    <th scope="col" className="px-3 py-2 font-medium">HSN</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Rate</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Discount</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Taxable</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">GST</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="tabular px-3 py-2 text-muted-foreground">{i.line_no}</td>
                      <td className="px-3 py-2">
                        {i.product_id && canSeeStock ? (
                          <Link href={`/app/inventory/${i.product_id}?outlet=${bill.outlet_id}`} className="hover:underline">
                            {i.description}
                          </Link>
                        ) : (
                          i.description
                        )}
                        {i.product_id ? null : <span className="block text-xs text-muted-foreground">Expense line, no stock</span>}
                      </td>
                      <td className="tabular px-3 py-2">{i.hsn_code ?? ""}</td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {formatQty(i.quantity)} {i.unit_code}
                      </td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {formatINR(i.rate_paise)}
                        {i.price_includes_tax ? <span className="block text-xs text-muted-foreground">incl. tax</span> : null}
                      </td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">{Number(i.discount_paise) > 0 ? formatINR(i.discount_paise) : ""}</td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatINR(i.taxable_paise)}</td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {formatINR(Number(i.cgst_paise) + Number(i.sgst_paise) + Number(i.igst_paise) + Number(i.cess_paise))}
                        <span className="block text-xs text-muted-foreground">
                          {formatRate(i.gst_rate)}
                          {Number(i.cess_rate) > 0 ? ` + ${formatRate(i.cess_rate)} cess` : ""}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium whitespace-nowrap">{formatINR(i.total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <section aria-labelledby="tax-heading">
            <h2 id="tax-heading" className="mb-2 text-sm font-semibold">
              Tax summary
            </h2>
            {taxRows.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No tax to show yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="tabular w-full min-w-[420px] text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">GST rate</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Taxable</th>
                      {bill.is_inter_state ? (
                        <th scope="col" className="px-3 py-2 text-right font-medium">IGST</th>
                      ) : (
                        <>
                          <th scope="col" className="px-3 py-2 text-right font-medium">CGST</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">SGST</th>
                        </>
                      )}
                      {hasCess ? <th scope="col" className="px-3 py-2 text-right font-medium">Cess</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {taxRows.map((r) => (
                      <tr key={r.gstRate}>
                        <td className="px-3 py-2">{formatRate(r.gstRate)}</td>
                        <td className="px-3 py-2 text-right">{formatINR(r.taxablePaise)}</td>
                        {bill.is_inter_state ? (
                          <td className="px-3 py-2 text-right">{formatINR(r.igstPaise)}</td>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right">{formatINR(r.cgstPaise)}</td>
                            <td className="px-3 py-2 text-right">{formatINR(r.sgstPaise)}</td>
                          </>
                        )}
                        {hasCess ? <td className="px-3 py-2 text-right">{formatINR(r.cessPaise)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border p-4" aria-labelledby="totals-heading">
            <h2 id="totals-heading" className="mb-3 text-sm font-semibold">
              Totals
            </h2>
            <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Taxable value</dt>
              <dd className="text-right">{formatINR(bill.taxable_paise)}</dd>
              {bill.is_inter_state ? (
                <>
                  <dt className="text-muted-foreground">IGST</dt>
                  <dd className="text-right">{formatINR(bill.igst_paise)}</dd>
                </>
              ) : (
                <>
                  <dt className="text-muted-foreground">CGST</dt>
                  <dd className="text-right">{formatINR(bill.cgst_paise)}</dd>
                  <dt className="text-muted-foreground">SGST</dt>
                  <dd className="text-right">{formatINR(bill.sgst_paise)}</dd>
                </>
              )}
              {hasCess ? (
                <>
                  <dt className="text-muted-foreground">Cess</dt>
                  <dd className="text-right">{formatINR(bill.cess_paise)}</dd>
                </>
              ) : null}
              {Number(bill.round_off_paise) !== 0 ? (
                <>
                  <dt className="text-muted-foreground">Round-off</dt>
                  <dd className="text-right">{formatINR(bill.round_off_paise)}</dd>
                </>
              ) : null}
              <dt className="border-t pt-2 font-medium">Bill total</dt>
              <dd className="border-t pt-2 text-right text-base font-semibold">{formatINR(bill.total_paise)}</dd>
              {isPosted ? (
                <>
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd className="text-right">{formatINR(bill.amount_paid_paise)}</dd>
                  <dt className="font-medium">Still to pay</dt>
                  <dd className="text-right font-semibold">{formatINR(outstanding)}</dd>
                </>
              ) : null}
            </dl>
          </section>
        </div>

        {isPosted || payments.length > 0 ? (
          <section aria-labelledby="payments-heading">
            <h2 id="payments-heading" className="mb-2 text-sm font-semibold">
              Payments to the supplier
            </h2>
            {payments.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No payments recorded yet.{canCreate ? " Use Record payment when you pay the supplier." : ""}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Paid on</th>
                      <th scope="col" className="px-3 py-2 font-medium">Paid by</th>
                      <th scope="col" className="px-3 py-2 font-medium">Reference</th>
                      <th scope="col" className="px-3 py-2 font-medium">Recorded by</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      {canPost && isPosted ? <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="tabular px-3 py-2 whitespace-nowrap">{formatDate(p.paid_on)}</td>
                        <td className="px-3 py-2">{PURCHASE_PAYMENT_MODE_LABELS[p.mode] ?? p.mode}</td>
                        <td className="tabular px-3 py-2">{p.reference ?? ""}</td>
                        <td className="px-3 py-2">{who(p.created_by)}</td>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatINR(p.amount_paise)}</td>
                        {canPost && isPosted ? (
                          <td className="px-3 py-1 text-right">
                            <DeletePaymentButton paymentId={p.id} label={formatINR(p.amount_paise)} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

        <section aria-labelledby="attachments-heading">
          <h2 id="attachments-heading" className="mb-2 text-sm font-semibold">
            Bill photo
          </h2>
          {bill.attachment_paths?.length ? (
            <ul className="flex flex-wrap gap-3">
              {bill.attachment_paths.map((path) => (
                <AttachmentTile key={path} path={path} url={attachmentUrls[path]} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No photo or PDF attached.{isDraft && canCreate ? " Tap Edit to add a photo of the bill." : ""}
            </p>
          )}
        </section>

        {!isDraft && canSeeStock ? (
          <section aria-labelledby="stock-heading">
            <h2 id="stock-heading" className="mb-2 text-sm font-semibold">
              Stock movements from this bill
            </h2>
            {movements.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                This bill did not change stock. Expense lines and products without stock tracking never do.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">When</th>
                      <th scope="col" className="px-3 py-2 font-medium">Product</th>
                      <th scope="col" className="px-3 py-2 font-medium">Type</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Ledger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="tabular px-3 py-2 whitespace-nowrap">{formatDateTime(m.created_at)}</td>
                        <td className="px-3 py-2">{m.product?.name ?? "Product"}</td>
                        <td className="px-3 py-2">{movementLabel(m.movement_type)}</td>
                        <td className={`tabular px-3 py-2 text-right whitespace-nowrap ${Number(m.quantity_delta) < 0 ? "text-red-700" : "text-emerald-700"}`}>
                          {signedQty(m.quantity_delta)} {m.product?.unit_code ?? ""}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/app/inventory/${m.product_id}?outlet=${bill.outlet_id}`} className="text-primary hover:underline">
                            Open ledger
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
