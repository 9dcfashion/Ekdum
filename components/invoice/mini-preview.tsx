import { DOCUMENT_TITLES, type DocumentType } from "@/lib/gst/config";
import { formatInvoiceNumber } from "@/lib/gst/numbering";
import { stateLabel } from "@/lib/gst/states";
import { financialYear } from "@/lib/dates";
import { formatINR } from "@/lib/money";

/** A small, static sketch of the A4 invoice used as a live preview in onboarding and settings. */
export function MiniInvoicePreview({
  name,
  address,
  gstin,
  stateCode,
  logoUrl,
  brandColor,
  documentType = "tax_invoice",
  prefix = "A",
  footer,
}: {
  name: string;
  address?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  logoUrl?: string | null;
  brandColor: string;
  documentType?: DocumentType;
  prefix?: string;
  footer?: string | null;
}) {
  let number = "A/2627/00001";
  try {
    number = formatInvoiceNumber(prefix || "A", financialYear(), 1);
  } catch {
    /* keep the sample while the prefix is being typed */
  }
  const showTax = documentType === "tax_invoice";

  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[10px] leading-tight text-zinc-800 shadow-sm" aria-label="Invoice preview">
      <div className="h-1.5" style={{ backgroundColor: brandColor }} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="size-9 rounded object-cover" />
            ) : (
              <div className="flex size-9 items-center justify-center rounded text-sm font-bold text-white" style={{ backgroundColor: brandColor }}>
                {(name || "E").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{name || "Your shop name"}</p>
              <p className="truncate text-zinc-500">{address || "Shop address"}</p>
              {gstin ? <p className="text-zinc-500">GSTIN: {gstin}</p> : null}
              {stateCode ? <p className="text-zinc-500">State: {stateLabel(stateCode)}</p> : null}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs font-semibold" style={{ color: brandColor }}>
              {DOCUMENT_TITLES[documentType]}
            </p>
            <p className="tabular text-zinc-500">{number}</p>
          </div>
        </div>

        <table className="mt-3 w-full">
          <thead>
            <tr className="text-left text-white" style={{ backgroundColor: brandColor }}>
              <th className="px-1.5 py-1 font-medium">Item</th>
              <th className="px-1.5 py-1 text-right font-medium">Qty</th>
              <th className="px-1.5 py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="tabular">
            <tr className="border-b">
              <td className="px-1.5 py-1">Sample item</td>
              <td className="px-1.5 py-1 text-right">2</td>
              <td className="px-1.5 py-1 text-right">{formatINR(showTax ? 100000 : 118000)}</td>
            </tr>
            {showTax ? (
              <tr className="border-b text-zinc-500">
                <td className="px-1.5 py-1" colSpan={2}>
                  CGST 9% + SGST 9%
                </td>
                <td className="px-1.5 py-1 text-right">{formatINR(18000)}</td>
              </tr>
            ) : null}
            <tr className="font-semibold">
              <td className="px-1.5 py-1" colSpan={2}>
                Total
              </td>
              <td className="px-1.5 py-1 text-right">{formatINR(118000)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 truncate text-center text-zinc-400">{footer || "Thank you for your business"}</p>
      </div>
    </div>
  );
}
