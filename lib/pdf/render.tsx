import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { qrDataUrl } from "@/lib/invoices/qr";
import type { InvoiceBundle } from "@/lib/invoices/types";
import { buildInvoiceView } from "@/lib/invoices/view";
import { logoUrl } from "@/lib/storage";
import { pdfSafeDeep } from "./format";
import { InvoiceDocument, type PdfImage } from "./invoice-document";

export { invoicePdfFilename } from "./format";

const LOGO_TIMEOUT_MS = 4000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** PNG and JPEG are the only formats the PDF engine embeds; detect them by their magic bytes. */
export function detectPdfImageFormat(data: Uint8Array): "png" | "jpg" | null {
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}

/** Fetches the public logo. Any failure (missing, slow, unsupported format) just means no logo. */
async function fetchLogo(path: string | null): Promise<PdfImage | null> {
  const url = logoUrl(path);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > LOGO_MAX_BYTES) return null;
    const format = detectPdfImageFormat(data);
    return format ? { data, format } : null;
  } catch {
    return null;
  }
}

/** Renders the A4 invoice PDF on the server. */
export async function renderInvoicePdf(bundle: InvoiceBundle): Promise<Buffer> {
  const view = buildInvoiceView(bundle);
  const [logo, upiQr] = await Promise.all([
    fetchLogo(view.logoPath),
    view.upi ? qrDataUrl(view.upi.uri) : Promise.resolve(null),
  ]);
  // The UPI link is built before sanitising, so the QR always encodes the real payee details.
  return renderToBuffer(<InvoiceDocument view={pdfSafeDeep(view)} logo={logo} upiQr={upiQr} />);
}
