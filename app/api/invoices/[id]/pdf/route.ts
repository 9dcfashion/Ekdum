import type { NextRequest } from "next/server";
import { loadInvoiceBundle } from "@/lib/invoices/load";
import { isPublicTokenShape, isUuid } from "@/lib/invoices/token";
import type { InvoiceBundle } from "@/lib/invoices/types";
import { getUser } from "@/lib/auth/context";
import { invoicePdfFilename, renderInvoicePdf } from "@/lib/pdf/render";
import { rateLimitByIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

function plain(message: string, status: number, extra: Record<string, string> = {}) {
  return new Response(message, {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra },
  });
}

/** One answer for "no such invoice", "not yours", "wrong token" and "link turned off". */
const notFound = () => plain("Not found", 404);

/**
 * GET /api/invoices/{id}/pdf
 *   - signed in: RLS decides whether this user may see the invoice.
 *   - ?token={public_token}: the public link. The token must belong to the invoice in the path.
 *   - ?download=1 sends it as a file download instead of showing it in the browser.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = request.nextUrl.searchParams;
  const token = search.get("token");
  const download = search.get("download") === "1";

  let bundle: InvoiceBundle | null = null;
  try {
    if (token !== null) {
      if (!(await rateLimitByIp("pdf:public", 30, 60))) {
        return plain("Too many requests. Please try again in a minute.", 429, { "Retry-After": "60" });
      }
      if (!isUuid(id) || !isPublicTokenShape(token)) return notFound();
      const found = await loadInvoiceBundle(createAdminClient(), { token });
      bundle = found && found.invoice.id === id ? found : null;
    } else {
      const session = await getUser();
      if (!session) return plain("Sign in to view this bill.", 401);
      if (!isUuid(id)) return notFound();
      bundle = await loadInvoiceBundle(session.supabase, { id });
    }
  } catch (error) {
    console.error("[invoice-pdf] could not load the invoice:", error instanceof Error ? error.message : "unknown error");
    return plain("Could not load this bill. Please try again.", 500);
  }
  if (!bundle) return notFound();

  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf(bundle);
  } catch (error) {
    console.error("[invoice-pdf] render failed:", error instanceof Error ? error.message : "unknown error");
    return plain("Could not create the PDF. Please try again.", 500);
  }

  const filename = invoicePdfFilename(bundle.invoice.invoice_number);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    },
  });
}
