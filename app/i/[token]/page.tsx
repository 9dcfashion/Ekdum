import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, Download, Mail, MapPin, Phone } from "lucide-react";
import { loadInvoiceBundle } from "@/lib/invoices/load";
import { qrDataUrl } from "@/lib/invoices/qr";
import { isPublicTokenShape } from "@/lib/invoices/token";
import { buildInvoiceView, type InvoiceView } from "@/lib/invoices/view";
import { formatINR } from "@/lib/money";
import { rateLimitByIp } from "@/lib/rate-limit";
import { logoUrl } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Never the bill number or shop name in the page title: this page must not leak into search results or link previews.
export const metadata: Metadata = {
  title: "Your bill",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

const POWERED_BY = "Powered by EkDum · NineAgents";

function TooManyRequests() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <Clock className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold">Too many requests</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This page was opened too many times in a short while. Please wait a minute and try again.
      </p>
      <p className="mt-10 text-xs text-muted-foreground">{POWERED_BY}</p>
    </main>
  );
}

function AmountRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular text-right">{value}</dd>
    </div>
  );
}

function Lines({ view }: { view: InvoiceView }) {
  return (
    <ul className="divide-y">
      {view.lines.map((line, index) => {
        const tax = view.showTax
          ? [
              `Taxable ${formatINR(line.taxablePaise)}`,
              view.interState
                ? `IGST ${line.gstRate} ${formatINR(line.igstPaise)}`
                : `CGST ${formatINR(line.cgstPaise)} + SGST ${formatINR(line.sgstPaise)} (GST ${line.gstRate})`,
              line.cessPaise > 0 ? `Cess ${formatINR(line.cessPaise)}` : null,
            ].filter(Boolean)
          : [];
        return (
          <li key={line.lineNo} className="flex gap-3 px-4 py-3 text-sm">
            <span className="tabular w-5 shrink-0 text-muted-foreground">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{line.description}</p>
              <p className="tabular mt-0.5 text-muted-foreground">
                {line.quantity} {line.unit} x {formatINR(line.unitPricePaise)}
                {line.hsn ? ` · HSN ${line.hsn}` : ""}
                {line.discountPaise > 0 ? ` · Discount ${formatINR(line.discountPaise)}` : ""}
              </p>
              {tax.length > 0 ? <p className="tabular mt-0.5 text-xs text-muted-foreground">{tax.join(" · ")}</p> : null}
            </div>
            <span className="tabular shrink-0 text-right font-medium">{formatINR(line.totalPaise)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Reject junk before it reaches the rate limiter or the database.
  if (!isPublicTokenShape(token)) notFound();
  if (!(await rateLimitByIp("invoice:public", 60, 60))) return <TooManyRequests />;

  // Unknown and revoked links both come back as null, and both get the same page.
  const bundle = await loadInvoiceBundle(createAdminClient(), { token });
  if (!bundle) notFound();

  const view = buildInvoiceView(bundle);
  const brand = view.brandColor;
  const logo = logoUrl(view.logoPath);
  const t = view.totals;
  const received = view.payments.filter((p) => p.mode !== "credit");
  const showPay = !!view.upi && view.upi.due;
  const upiQr = showPay && view.upi ? await qrDataUrl(view.upi.uri, 360) : null;
  const pdfHref = `/api/invoices/${view.id}/pdf?token=${token}`;

  return (
    <main className="min-h-screen flex-1 bg-muted/40 pb-10">
      <div className="h-1.5" style={{ backgroundColor: brand }} />
      <div className="mx-auto w-full max-w-2xl px-3 pt-4 sm:px-4 sm:pt-8">
        {/* Shop */}
        <header className="flex items-start gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="size-14 shrink-0 rounded-lg border bg-white object-contain" />
          ) : (
            <div
              className="flex size-14 shrink-0 items-center justify-center rounded-lg text-xl font-bold text-white"
              style={{ backgroundColor: brand }}
              aria-hidden
            >
              {view.seller.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 text-sm">
            <p className="text-lg leading-tight font-semibold break-words">{view.seller.name}</p>
            {view.seller.legalName ? <p className="text-muted-foreground">{view.seller.legalName}</p> : null}
            {view.seller.addressLines.length > 0 || view.seller.state ? (
              <p className="mt-1 flex gap-1.5 text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{[...view.seller.addressLines, view.seller.state].filter(Boolean).join(", ")}</span>
              </p>
            ) : null}
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {view.seller.phone ? (
                <a href={`tel:${view.seller.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Phone className="size-3.5" aria-hidden />
                  {view.seller.phone}
                </a>
              ) : null}
              {view.seller.email ? (
                <a href={`mailto:${view.seller.email}`} className="inline-flex items-center gap-1.5 break-all text-primary hover:underline">
                  <Mail className="size-3.5" aria-hidden />
                  {view.seller.email}
                </a>
              ) : null}
            </p>
            {view.seller.gstin ? <p className="tabular mt-1 font-medium">GSTIN: {view.seller.gstin}</p> : null}
          </div>
        </header>

        {/* Document */}
        <article className="mt-4 overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4">
            <div>
              <h1 className="text-base font-semibold tracking-wide uppercase" style={{ color: brand }}>
                {view.title}
              </h1>
              <p className="tabular text-sm font-medium">{view.number}</p>
              <p className="tabular text-sm text-muted-foreground">Date: {view.date}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="tabular text-2xl font-semibold">{formatINR(t.totalPaise)}</p>
              {view.cancelled ? (
                <p className="mt-1 inline-block rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                  CANCELLED
                </p>
              ) : view.amountDuePaise > 0 ? (
                <p className="tabular mt-1 text-sm font-medium text-amber-700">Balance due {formatINR(view.amountDuePaise)}</p>
              ) : (
                <p className="mt-1 text-sm font-medium text-emerald-700">Paid</p>
              )}
            </div>
          </div>

          {view.cancelled ? (
            <p className="border-b bg-red-50 px-4 py-2 text-sm text-red-700">
              This bill was cancelled by the shop and is no longer valid.
            </p>
          ) : null}

          <dl className="grid gap-4 border-b px-4 py-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bill to</dt>
              <dd className="mt-1">
                {view.recipient ? (
                  <>
                    {view.recipient.name ? <p className="font-medium">{view.recipient.name}</p> : null}
                    {view.recipient.addressLines.map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                    {view.recipient.state ? <p>State: {view.recipient.state}</p> : null}
                    {view.recipient.phone ? <p className="tabular">Phone: {view.recipient.phone}</p> : null}
                    {view.recipient.gstin ? <p className="tabular">GSTIN: {view.recipient.gstin}</p> : null}
                  </>
                ) : (
                  <p>Cash sale</p>
                )}
              </dd>
            </div>
            {view.showGstFields ? (
              <div>
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Supply details</dt>
                <dd className="mt-1">
                  {view.placeOfSupply ? <p>Place of supply: {view.placeOfSupply}</p> : null}
                  {view.reverseCharge ? <p>Reverse charge: {view.reverseCharge}</p> : null}
                </dd>
              </div>
            ) : null}
          </dl>

          <Lines view={view} />

          <dl className="border-t px-4 py-3 text-sm">
            {view.showTax ? (
              <AmountRow label="Taxable value" value={formatINR(t.taxablePaise)} />
            ) : (
              <AmountRow label="Subtotal" value={formatINR(t.subtotalPaise)} />
            )}
            {t.discountPaise > 0 ? (
              <AmountRow label={view.showTax ? "Discount given" : "Discount"} value={`-${formatINR(t.discountPaise)}`} />
            ) : null}
            {view.showTax && !view.interState ? <AmountRow label="CGST" value={formatINR(t.cgstPaise)} /> : null}
            {view.showTax && !view.interState ? <AmountRow label="SGST" value={formatINR(t.sgstPaise)} /> : null}
            {view.showTax && view.interState ? <AmountRow label="IGST" value={formatINR(t.igstPaise)} /> : null}
            {view.showCess ? <AmountRow label="Cess" value={formatINR(t.cessPaise)} /> : null}
            {t.roundOffPaise !== 0 ? <AmountRow label="Round off" value={formatINR(t.roundOffPaise)} /> : null}
            <div className="mt-1 border-t pt-1">
              <AmountRow label="Total" value={formatINR(t.totalPaise)} strong />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{view.amountInWords}</p>
          </dl>

          {view.taxSummary.length > 0 ? (
            <div className="border-t px-4 py-3">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tax summary</h2>
              <div className="mt-2 overflow-x-auto">
                <table className="tabular w-full min-w-[320px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1 pr-3 font-medium">GST rate</th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">Taxable</th>
                      {view.interState ? (
                        <th scope="col" className="py-1 pr-3 text-right font-medium">IGST</th>
                      ) : (
                        <>
                          <th scope="col" className="py-1 pr-3 text-right font-medium">CGST</th>
                          <th scope="col" className="py-1 pr-3 text-right font-medium">SGST</th>
                        </>
                      )}
                      {view.showCess ? <th scope="col" className="py-1 text-right font-medium">Cess</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {view.taxSummary.map((row) => (
                      <tr key={row.gstRate} className="border-t">
                        <td className="py-1 pr-3">{row.rateLabel}</td>
                        <td className="py-1 pr-3 text-right">{formatINR(row.taxablePaise)}</td>
                        {view.interState ? (
                          <td className="py-1 pr-3 text-right">{formatINR(row.igstPaise)}</td>
                        ) : (
                          <>
                            <td className="py-1 pr-3 text-right">{formatINR(row.cgstPaise)}</td>
                            <td className="py-1 pr-3 text-right">{formatINR(row.sgstPaise)}</td>
                          </>
                        )}
                        {view.showCess ? <td className="py-1 text-right">{formatINR(row.cessPaise)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!view.cancelled && received.length > 0 ? (
            <dl className="border-t px-4 py-3 text-sm">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Payments</p>
              {received.map((p, i) => (
                <AmountRow key={i} label={`${p.date} · ${p.label}`} value={formatINR(p.amountPaise)} />
              ))}
              {view.amountDuePaise > 0 ? (
                <AmountRow label="Balance due" value={formatINR(view.amountDuePaise)} strong />
              ) : null}
            </dl>
          ) : null}

          {view.declaration ? <p className="border-t px-4 py-3 text-sm font-medium">{view.declaration}</p> : null}

          {view.terms.length > 0 ? (
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              <h2 className="font-medium tracking-wide uppercase">Terms</h2>
              {view.terms.map((line, i) => (
                <p key={i} className="mt-1">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </article>

        {/* Actions */}
        <div className="mt-4 grid gap-3">
          <a
            href={`${pdfHref}&download=1`}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            style={{ backgroundColor: brand }}
          >
            <Download className="size-5" aria-hidden />
            Download PDF
          </a>

          {showPay && view.upi ? (
            <section className="rounded-xl border bg-card px-4 py-4 text-center" aria-labelledby="pay-title">
              <h2 id="pay-title" className="text-sm font-semibold">
                Pay {formatINR(view.upi.amountPaise)} by UPI
              </h2>
              {upiQr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={upiQr}
                  alt={`UPI QR code to pay ${formatINR(view.upi.amountPaise)}`}
                  className="mx-auto mt-3 size-44"
                />
              ) : null}
              <p className="mt-2 text-xs break-all text-muted-foreground">UPI ID: {view.upi.id}</p>
              <a
                href={view.upi.uri}
                className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted sm:hidden"
              >
                Open UPI app
              </a>
            </section>
          ) : null}
        </div>

        {view.footer ? <p className="mt-6 text-center text-sm text-muted-foreground">{view.footer}</p> : null}
        <p className="mt-6 text-center text-xs text-muted-foreground">{POWERED_BY}</p>
      </div>
    </main>
  );
}
