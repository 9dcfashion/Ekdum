import "server-only";
import type { ServerClient } from "@/lib/supabase/server";
import type { ReportDefinition } from "./definitions";
import type { ReportFilters } from "./filters";
import type { ReportRow } from "./format";

const BATCH = 1000;

export interface ReportResult {
  rows: ReportRow[];
  /** Rows the report has in total (may be more than `rows` when the limit was hit). */
  total: number;
  truncated: boolean;
  error: { message: string; forbidden: boolean } | null;
}

/**
 * Run a report RPC and collect every row. PostgREST caps one response
 * (1000 rows by default), so the result is read in batches until the exact
 * count is reached or `limit` rows have been collected.
 */
export async function fetchReport(
  supabase: ServerClient,
  def: ReportDefinition,
  businessId: string,
  filters: Pick<ReportFilters, "from" | "to" | "outletId">,
  limit: number,
): Promise<ReportResult> {
  const args: Record<string, string | null> = { p_business_id: businessId, p_outlet_id: filters.outletId };
  if (def.hasDates) {
    args.p_from = filters.from;
    args.p_to = filters.to;
  }

  const rows: ReportRow[] = [];
  let total = 0;
  while (rows.length < limit) {
    const { data, error, count } = await supabase
      .rpc(def.rpc, args, { count: "exact" })
      .range(rows.length, rows.length + BATCH - 1);
    if (error) {
      return { rows: [], total: 0, truncated: false, error: { message: error.message, forbidden: error.code === "42501" } };
    }
    const batch = (data ?? []) as ReportRow[];
    rows.push(...batch);
    total = Math.max(count ?? 0, rows.length);
    if (batch.length === 0 || rows.length >= total) break;
  }
  if (rows.length > limit) rows.length = limit;
  return { rows, total, truncated: total > rows.length, error: null };
}
