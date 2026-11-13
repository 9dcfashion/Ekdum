import type { NextRequest } from "next/server";
import { loadContext } from "@/lib/auth/context";
import { istDateString } from "@/lib/dates";
import { toCsv } from "@/lib/list";
import { getReport } from "@/lib/reports/definitions";
import { fetchReport } from "@/lib/reports/fetch";
import { parseFilters } from "@/lib/reports/filters";
import { buildCsv, csvFilename } from "@/lib/reports/format";

export const dynamic = "force-dynamic";

/** Safety valve only: far more rows than any shop produces in 400 days. */
const EXPORT_LIMIT = 500_000;

function plain(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report: key } = await params;
  const def = getReport(key);
  if (!def) return plain("Report not found", 404);

  // Never trust that the page was allowed to render: check the user again here.
  const ctx = await loadContext();
  if (!ctx) return plain("Please sign in again", 401);
  if (!ctx.business || !ctx.business.onboarding_completed_at) return plain("You are not allowed to export reports", 403);
  if (!ctx.can("reports.view") || !ctx.can("reports.export") || (def.requires && !ctx.can(def.requires))) {
    return plain("You are not allowed to export this report", 403);
  }

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseFilters(sp, ctx.outlets.map((o) => o.id), "30d");
  const result = await fetchReport(ctx.supabase, def, ctx.business.id, filters, EXPORT_LIMIT);
  if (result.error) {
    return result.error.forbidden
      ? plain("You are not allowed to export this report", 403)
      : plain("Could not build the report. Please try again.", 500);
  }
  if (result.truncated) return plain("This report is too large to export. Choose a shorter date range.", 413);

  const { headers, rows } = buildCsv(def.columns, result.rows);
  const filename = csvFilename(def.key, def.hasDates ? { from: filters.from, to: filters.to } : null, istDateString());

  return new Response(toCsv(headers, rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
