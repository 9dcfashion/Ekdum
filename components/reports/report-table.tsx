"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

/**
 * Table for a report. Cells arrive already formatted on the server from the
 * report definition (the same one the CSV uses). Pages are flipped in the browser.
 */
export function ReportTable({
  title,
  columns,
  rows,
  totals,
}: {
  title: string;
  columns: Array<{ header: string; numeric: boolean }>;
  rows: string[][];
  /** One formatted cell per column, or null when the report has no totals. */
  totals: string[] | null;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  const visible = rows.slice(start, start + PAGE_SIZE);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-muted/50">
            <tr className="border-b">
              {columns.map((c, i) => (
                <th key={i} scope="col" className={cn("h-9 px-2.5 font-medium whitespace-nowrap", c.numeric ? "text-right" : "text-left")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, r) => (
              <tr key={start + r} className="border-b last:border-0 hover:bg-muted/40">
                {row.map((cell, i) => (
                  <td
                    key={i}
                    className={cn("max-w-64 truncate px-2.5 py-1.5 whitespace-nowrap", columns[i]?.numeric && "tabular text-right")}
                    title={cell.length > 30 ? cell : undefined}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr className="border-t bg-muted/50 font-medium">
                {totals.map((cell, i) => (
                  <td key={i} className={cn("px-2.5 py-2 whitespace-nowrap", columns[i]?.numeric && "tabular text-right")}>
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {pages > 1 ? (
        <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Pagination">
          <p className="tabular text-xs text-muted-foreground">
            {start + 1} to {Math.min(start + PAGE_SIZE, rows.length)} of {rows.length}
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>
              <ChevronLeft /> Prev
            </Button>
            <span className="px-1 text-xs text-muted-foreground">
              Page {current} of {pages}
            </span>
            <Button variant="outline" size="sm" disabled={current >= pages} onClick={() => setPage(current + 1)}>
              Next <ChevronRight />
            </Button>
          </div>
        </nav>
      ) : (
        <p className="tabular mt-3 text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </p>
      )}
    </div>
  );
}
