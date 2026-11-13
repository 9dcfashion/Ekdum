/** Helpers for list pages whose filters live in the URL. */
export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 25;

export function param(sp: SearchParams, key: string): string {
  const v = sp[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export function pageParam(sp: SearchParams): number {
  const n = Number.parseInt(param(sp, "page"), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Supabase .range() bounds for a page. */
export function pageRange(page: number, pageSize = PAGE_SIZE): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

/** Escape a user search term for use inside a PostgREST `or=(col.ilike.*term*)` filter. */
export function ilikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, "\\$&").replace(/[,()"]/g, " ").trim();
}

/** Build CSV text (RFC 4180, with a BOM so Excel opens ₹ and Indian names correctly). */
export function toCsv(headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Stop spreadsheet formula injection from user-entered text.
    if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
