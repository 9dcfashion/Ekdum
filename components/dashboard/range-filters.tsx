"use client";

import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/shared/field";
import { useListParams } from "@/components/shared/list-controls";
import type { DateRangePreset } from "@/lib/dates";
import { RANGE_PRESETS } from "@/lib/reports/filters";
import { cn } from "@/lib/utils";

/**
 * Outlet + date-range filters kept in the URL (`outlet`, `range`, `from`, `to`).
 * Used by the dashboard and by every report.
 */
export function RangeFilters({
  outlets,
  preset,
  from,
  to,
  showDates = true,
  className,
}: {
  outlets: Array<{ id: string; name: string }>;
  /** The preset in effect (after defaults were applied on the server). */
  preset: DateRangePreset;
  from: string;
  to: string;
  showDates?: boolean;
  className?: string;
}) {
  const { searchParams, setParams, pending } = useListParams();
  const showOutlets = outlets.length > 1;
  if (!showOutlets && !showDates) return null;

  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>
      {showOutlets ? (
        <NativeSelect
          aria-label="Outlet"
          value={searchParams.get("outlet") ?? ""}
          onChange={(e) => setParams({ outlet: e.target.value || null })}
          className="w-auto max-w-full min-w-36"
        >
          <option value="">All outlets</option>
          {outlets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}

      {showDates ? (
        <div role="group" aria-label="Date range" className="flex max-w-full overflow-x-auto rounded-lg border bg-background p-0.5">
          {RANGE_PRESETS.map((p) => {
            const active = p.value === preset;
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setParams(
                    p.value === "custom"
                      ? { range: "custom", from, to }
                      : { range: p.value, from: null, to: null },
                  )
                }
                className={cn(
                  "h-7 shrink-0 rounded-md px-2.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {showDates && preset === "custom" ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            From
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && setParams({ range: "custom", from: e.target.value, to })}
              className="w-auto"
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            To
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => e.target.value && setParams({ range: "custom", from, to: e.target.value })}
              className="w-auto"
            />
          </label>
        </div>
      ) : null}

      {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" /> : null}
    </div>
  );
}
