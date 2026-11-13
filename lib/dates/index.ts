/** All business dates are Asia/Kolkata (UTC+05:30, no DST). */
export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The calendar date in IST for an instant, as "YYYY-MM-DD". */
export function istDateString(at: Date | string | number = new Date()): string {
  const d = new Date(new Date(at).getTime() + IST_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  const iso = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istDateString(date);
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Timestamp → "DD/MM/YYYY, hh:mm am/pm" in IST. */
export function formatDateTime(at: string | Date | null | undefined): string {
  if (!at) return "";
  const date = new Date(at);
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${formatDate(istDateString(date))}, ${time}`;
}

/** Add days to a "YYYY-MM-DD" date string. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Indian financial year (1 April – 31 March) for an IST date, in the compact
 * form used in invoice numbers: 2026-04-01 → "2627", 2027-03-31 → "2627".
 */
export function financialYear(date: string | Date = new Date()): string {
  const iso = typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : istDateString(date);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "2627" → "2026-27". */
export function financialYearLabel(fy: string): string {
  return `20${fy.slice(0, 2)}-${fy.slice(2)}`;
}

export type DateRangePreset = "today" | "yesterday" | "7d" | "30d" | "custom";

/** Resolve a dashboard range preset to inclusive IST dates. */
export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { from?: string; to?: string },
  now: Date = new Date(),
): { from: string; to: string } {
  const today = istDateString(now);
  switch (preset) {
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "custom": {
      const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
      const from = valid(custom?.from) ?? today;
      const to = valid(custom?.to) ?? from;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default:
      return { from: today, to: today };
  }
}
