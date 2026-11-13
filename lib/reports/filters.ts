import { addDays, resolveDateRange, type DateRangePreset } from "@/lib/dates";
import { param, type SearchParams } from "@/lib/list";

export const RANGE_PRESETS: ReadonlyArray<{ value: DateRangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

/** dashboard_summary rejects ranges longer than this; reports use the same cap to stay fast. */
export const MAX_RANGE_DAYS = 400;

export interface ReportFilters {
  preset: DateRangePreset;
  from: string;
  to: string;
  /** Null means "all outlets I can access". */
  outletId: string | null;
  /** True when a custom range was longer than MAX_RANGE_DAYS and was shortened. */
  clamped: boolean;
}

function isPreset(v: string): v is DateRangePreset {
  return RANGE_PRESETS.some((p) => p.value === v);
}

/** Read the outlet and date-range filters from the URL. Unknown values fall back to safe defaults. */
export function parseFilters(
  sp: SearchParams,
  outletIds: readonly string[],
  defaultPreset: DateRangePreset,
  now: Date = new Date(),
): ReportFilters {
  const wanted = param(sp, "range");
  const preset = isPreset(wanted) ? wanted : defaultPreset;
  const resolved = resolveDateRange(preset, { from: param(sp, "from"), to: param(sp, "to") }, now);
  const { to } = resolved;
  let { from } = resolved;
  let clamped = false;
  const earliest = addDays(to, -MAX_RANGE_DAYS);
  if (from < earliest) {
    from = earliest;
    clamped = true;
  }
  const outlet = param(sp, "outlet");
  return { preset, from, to, outletId: outletIds.includes(outlet) ? outlet : null, clamped };
}

/** Query string that reproduces these filters (used for the CSV link). */
export function filtersQuery(sp: SearchParams): string {
  const q = new URLSearchParams();
  for (const key of ["range", "from", "to", "outlet"]) {
    const v = param(sp, key);
    if (v) q.set(key, v);
  }
  return q.toString();
}
