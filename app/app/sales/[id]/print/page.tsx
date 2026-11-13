import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PrintToolbar, type PrintFormatLink } from "@/components/invoice/print-toolbar";
import { ThermalReceipt, thermalCss } from "@/components/invoice/thermal-receipt";
import { requireContext } from "@/lib/auth/context";
import { loadInvoiceBundle } from "@/lib/invoices/load";
import { qrDataUrl } from "@/lib/invoices/qr";
import { buildInvoiceView } from "@/lib/invoices/view";
import { logoUrl } from "@/lib/storage";
import type { PrintFormat } from "@/lib/types/db";

export const metadata: Metadata = {
  title: "Print bill",
  robots: { index: false, follow: false },
};

const FORMATS: readonly PrintFormat[] = ["thermal_80", "thermal_58", "a4"];
const FORMAT_LABELS: Record<PrintFormat, string> = { thermal_80: "80mm", thermal_58: "58mm", a4: "A4" };

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function PrintInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await requireContext();
  if (!ctx.can(["sales.view_all", "sales.view_own", "sales.create"])) redirect("/app/no-access");

  const { id } = await params;
  const sp = await searchParams;

  // RLS limits this to bills the user may see; the business check keeps it to the active business.
  const bundle = await loadInvoiceBundle(ctx.supabase, { id });
  if (!bundle || bundle.invoice.business_id !== ctx.business.id) notFound();

  const requested = first(sp.format);
  const format: PrintFormat = FORMATS.includes(requested as PrintFormat)
    ? (requested as PrintFormat)
    : (bundle.business.default_print_format ?? ctx.business.default_print_format ?? "thermal_80");

  const pdfHref = `/api/invoices/${bundle.invoice.id}/pdf`;
  // A4 has one master template: the PDF. The browser's PDF viewer prints and downloads it.
  if (format === "a4") redirect(pdfHref);

  const showLogo = first(sp.logo) !== "0";
  const autoPrint = first(sp.print) !== "0";
  const view = buildInvoiceView(bundle);
  // The pay-by-UPI code is printed when money is still owed (or always with ?qr=1).
  const wantQr = !!view.upi && (view.upi.due || first(sp.qr) === "1");

  const [upiQr, cashier] = await Promise.all([
    view.upi && wantQr ? qrDataUrl(view.upi.uri, 320) : Promise.resolve(null),
    bundle.invoice.created_by
      ? ctx.supabase
          .from("profiles")
          .select("full_name")
          .eq("id", bundle.invoice.created_by)
          .maybeSingle<{ full_name: string }>()
          .then(({ data }) => data?.full_name?.trim() || null)
      : Promise.resolve(null),
  ]);

  const base = `/app/sales/${bundle.invoice.id}/print`;
  const qrSuffix = first(sp.qr) === "1" ? "&qr=1" : "";
  const suffix = `${showLogo ? "" : "&logo=0"}${qrSuffix}`;
  const formats: PrintFormatLink[] = FORMATS.map((f) => ({
    label: FORMAT_LABELS[f],
    href: f === "a4" ? pdfHref : `${base}?format=${f}${suffix}`,
    active: f === format,
  }));

  return (
    <div className="min-h-screen flex-1 bg-zinc-100 print:bg-white">
      {/*
        Paper size (@page) and slip styles for the chosen roll width. The CSS is built on the
        server from two fixed widths only (no user input), so injecting it as-is is safe;
        as plain children React would escape the quotes in the font names.
      */}
      <style dangerouslySetInnerHTML={{ __html: thermalCss(format === "thermal_58" ? 58 : 80) }} />
      <PrintToolbar
        formats={formats}
        backHref={`/app/sales/${bundle.invoice.id}`}
        autoPrint={autoPrint}
        logoToggle={
          view.logoPath
            ? { on: showLogo, href: `${base}?format=${format}${showLogo ? "&logo=0" : ""}${qrSuffix}&print=0` }
            : null
        }
      />
      <ThermalReceipt
        view={view}
        logoSrc={showLogo ? logoUrl(view.logoPath) : null}
        upiQr={upiQr}
        cashier={cashier}
      />
    </div>
  );
}
