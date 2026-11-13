import { notFound, redirect } from "next/navigation";
import { Download, FileSpreadsheet } from "lucide-react";
import { RangeFilters } from "@/components/dashboard/range-filters";
import { ReportTable } from "@/components/reports/report-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { SearchParams } from "@/lib/list";
import { getReport } from "@/lib/reports/definitions";
import { fetchReport } from "@/lib/reports/fetch";
import { filtersQuery, parseFilters } from "@/lib/reports/filters";
import { buildTableRows, computeTotals, formatTotalsRow, hasTotals, isNumericColumn } from "@/lib/reports/format";

/** Rows read for the page (totals cover all of them). */
const FETCH_LIMIT = 20_000;
/** Rows sent to the browser. The CSV always has everything. */
const DISPLAY_LIMIT = 1_000;

export async function generateMetadata({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  return { title: getReport(report)?.title ?? "Report" };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { report: key } = await params;
  const def = getReport(key);
  if (!def) notFound();

  const ctx = await requirePage("reports.view");
  if (def.requires && !ctx.can(def.requires)) redirect("/app/no-access");
  const sp = await searchParams;
  const filters = parseFilters(sp, ctx.outlets.map((o) => o.id), "30d");

  const result = await fetchReport(ctx.supabase, def, ctx.business.id, filters, FETCH_LIMIT);
  if (result.error) {
    if (result.error.forbidden) redirect("/app/no-access");
    throw new Error(`Could not load the report: ${result.error.message}`);
  }

  const { rows, total, truncated } = result;
  const totals = hasTotals(def.columns)
    ? formatTotalsRow(def.columns, computeTotals(def.columns, rows, def.totalsInclude), def.totalsLabel)
    : null;
  const tableRows = buildTableRows(def.columns, rows.slice(0, DISPLAY_LIMIT));
  const query = filtersQuery(sp);
  const exportHref = `/app/reports/${def.key}/export${query ? `?${query}` : ""}`;
  const period = def.hasDates
    ? filters.from === filters.to
      ? formatDate(filters.from)
      : `${formatDate(filters.from)} to ${formatDate(filters.to)}`
    : `As of ${formatDateTime(new Date())}`;

  return (
    <>
      <PageHeader
        title={def.title}
        description={def.description}
        backHref="/app/reports"
        actions={
          ctx.can("reports.export") ? (
            <Button variant="outline" asChild>
              <a href={exportHref} download>
                <Download /> Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <RangeFilters
        outlets={ctx.outlets.map((o) => ({ id: o.id, name: o.name }))}
        preset={filters.preset}
        from={filters.from}
        to={filters.to}
        showDates={def.hasDates}
      />

      <p className="mb-3 text-xs text-muted-foreground">
        {period} (IST). Amounts are in rupees.{def.note ? ` ${def.note}` : ""}
        {def.hasDates && filters.clamped ? ` Reports cover up to 400 days at a time, so the start date was moved to ${formatDate(filters.from)}.` : ""}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title={def.emptyTitle}
          description={def.hasDates ? "Try a longer date range or a different outlet." : "Products with stock tracking turned on will show up here."}
        />
      ) : (
        <>
          {rows.length > DISPLAY_LIMIT || truncated ? (
            <p className="mb-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
              Showing the first {DISPLAY_LIMIT.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} rows.{" "}
              {truncated
                ? `Totals cover the first ${rows.length.toLocaleString("en-IN")} rows only. Choose a shorter date range for exact totals.`
                : "Totals cover all rows."}{" "}
              {ctx.can("reports.export") ? "Export the CSV for the full list." : ""}
            </p>
          ) : null}
          <ReportTable
            key={`${def.key}?${query}`}
            title={def.title}
            columns={def.columns.map((c) => ({ header: c.header, numeric: isNumericColumn(c) }))}
            rows={tableRows}
            totals={totals}
          />
        </>
      )}
    </>
  );
}
