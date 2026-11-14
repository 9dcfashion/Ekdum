import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Clock, Download, Mail, Phone } from "lucide-react";
import { InvoiceSheet } from "@/components/invoice/invoice-sheet";
import { loadInvoiceBundle } from "@/lib/invoices/load";
import { qrDataUrl } from "@/lib/invoices/qr";
import { isPublicTokenShape } from "@/lib/invoices/token";
import { buildInvoiceView } from "@/lib/invoices/view";
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
  const total = view.totals.totalPaise;
  const showPay = !!view.upi && view.upi.due;
  // One QR for both places: small inside the bill's bank details, large in the pay box below it.
  const upiQr = view.upi ? await qrDataUrl(view.upi.uri, 360) : null;
  const pdfHref = `/api/invoices/${view.id}/pdf?token=${token}`;

  return (
    <main className="min-h-screen flex-1 bg-muted/40 pb-10">
      <div className="h-1.5" style={{ backgroundColor: brand }} />
      <div className="mx-auto w-full max-w-4xl px-3 pt-4 sm:px-4 sm:pt-6">
        {/* Summary and the download, above the bill so they are never off-screen on a phone */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium text-muted-foreground">
              {view.title} <span className="tabular">{view.number}</span> · {view.date}
            </h1>
            <p className="truncate text-base font-semibold">{view.seller.name}</p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-2xl font-semibold">{formatINR(total)}</span>
              {view.cancelled ? (
                <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                  CANCELLED
                </span>
              ) : view.amountDuePaise > 0 ? (
                <span className="tabular text-sm font-medium text-amber-700">
                  Balance due {formatINR(view.amountDuePaise)}
                </span>
              ) : (
                <span className="text-sm font-medium text-emerald-700">Paid</span>
              )}
            </p>
          </div>
          <a
            href={`${pdfHref}&download=1`}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
            style={{ backgroundColor: brand }}
          >
            <Download className="size-5" aria-hidden />
            Download PDF
          </a>
        </header>

        {view.cancelled ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            This bill was cancelled by the shop and is no longer valid.
          </p>
        ) : null}

        {/* The bill itself, in the shop's own format. Phones scroll it sideways. */}
        <div className="mt-4 overflow-x-auto rounded-lg border bg-white shadow-sm" tabIndex={0} aria-label="Bill">
          <InvoiceSheet view={view} logoSrc={logoUrl(view.logoPath)} upiQr={upiQr} />
        </div>
        <p className="mt-1.5 text-center text-xs text-muted-foreground sm:hidden">Swipe sideways to see the whole bill.</p>

        {showPay && view.upi ? (
          <section className="mx-auto mt-4 max-w-sm rounded-xl border bg-card px-4 py-4 text-center" aria-labelledby="pay-title">
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

        {view.seller.phone || view.seller.email ? (
          <p className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
            {view.seller.phone ? (
              <a href={`tel:${view.seller.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                <Phone className="size-3.5" aria-hidden />
                Call the shop
              </a>
            ) : null}
            {view.seller.email ? (
              <a href={`mailto:${view.seller.email}`} className="inline-flex items-center gap-1.5 break-all text-primary hover:underline">
                <Mail className="size-3.5" aria-hidden />
                {view.seller.email}
              </a>
            ) : null}
          </p>
        ) : null}
        <p className="mt-6 text-center text-xs text-muted-foreground">{POWERED_BY}</p>
      </div>
    </main>
  );
}
