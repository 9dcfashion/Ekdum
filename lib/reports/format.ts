import { Decimal, formatINR, formatQty, paiseToRupees } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { stateLabel } from "@/lib/gst/states";

/** One row as returned by a report RPC. */
export type ReportRow = Record<string, unknown>;

export type ColumnType = "text" | "money" | "qty" | "number" | "date" | "datetime" | "state" | "boolean";

export interface ReportColumn {
  /** Column name in the RPC result (also the default accessor). */
  key: string;
  header: string;
  type: ColumnType;
  /** Include this column in the totals row. Only for money, qty and number columns. */
  total?: boolean;
  /** Read the raw value from a row. Defaults to `row[key]`. */
  accessor?: (row: ReportRow) => unknown;
  /** Friendly labels for coded text values (e.g. "tax_invoice" → "Tax invoice"). */
  labels?: Readonly<Record<string, string>>;
}

export type CsvCell = string | number | null;

const NUMERIC_TYPES: readonly ColumnType[] = ["money", "qty", "number"];

export function isNumericColumn(col: Pick<ReportColumn, "type">): boolean {
  return NUMERIC_TYPES.includes(col.type);
}

export function rawValue(col: ReportColumn, row: ReportRow): unknown {
  return col.accessor ? col.accessor(row) : row[col.key];
}

function isBlank(v: unknown): v is null | undefined | "" {
  return v === null || v === undefined || v === "";
}

/** Numbers arrive as JSON numbers, but bigint/numeric can also arrive as strings. Null when not a number. */
function toDecimal(v: unknown): Decimal | null {
  if (isBlank(v)) return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function dateOnly(v: unknown): string {
  if (v instanceof Date) return formatDate(v);
  const s = String(v);
  // A "date" column may arrive as "YYYY-MM-DD" or as a full timestamp.
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDate(s) : formatDate(new Date(s));
}

function textValue(col: ReportColumn, v: unknown): string {
  const s = String(v);
  return col.labels?.[s] ?? s;
}

function stateText(v: unknown): string {
  const code = String(v);
  return stateLabel(code) || code;
}

/** The value shown in the on-screen table. Empty string for missing values. */
export function formatCell(col: ReportColumn, row: ReportRow): string {
  return formatValue(col, rawValue(col, row));
}

export function formatValue(col: ReportColumn, v: unknown): string {
  if (isBlank(v)) return "";
  switch (col.type) {
    case "money": {
      const d = toDecimal(v);
      return d ? formatINR(d.toNumber(), { symbol: false }) : "";
    }
    case "qty": {
      const d = toDecimal(v);
      return d ? formatQty(d.toNumber()) : "";
    }
    case "number": {
      const d = toDecimal(v);
      return d ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(d.toNumber()) : "";
    }
    case "date":
      return dateOnly(v);
    case "datetime":
      return formatDateTime(v as string | Date);
    case "state":
      return stateText(v);
    case "boolean":
      return v === true || v === "true" || v === "t" ? "Yes" : "No";
    default:
      return textValue(col, v);
  }
}

/**
 * The value written to the CSV: rupees as plain decimals ("1234.50"), plain
 * quantities, DD/MM/YYYY dates, state codes with names. Null for missing values.
 */
export function csvValue(col: ReportColumn, v: unknown): CsvCell {
  if (isBlank(v)) return null;
  switch (col.type) {
    case "money": {
      const d = toDecimal(v);
      if (!d) return null;
      const rupees = paiseToRupees(d.toNumber());
      // toCsv puts a quote in front of text that starts with "-" (formula guard),
      // so negative amounts go out as real numbers and stay numeric in a spreadsheet.
      return d.isNegative() ? Number(rupees) : rupees;
    }
    case "qty":
    case "number": {
      const d = toDecimal(v);
      return d ? d.toNumber() : null;
    }
    default:
      return formatValue(col, v);
  }
}

export function csvCell(col: ReportColumn, row: ReportRow): CsvCell {
  return csvValue(col, rawValue(col, row));
}

/**
 * Sum the columns marked `total`. Returns one entry per column: a raw total
 * (paise for money) or null for columns that are not totalled.
 */
export function computeTotals(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  include?: (row: ReportRow) => boolean,
): Array<number | null> {
  const counted = include ? rows.filter(include) : rows;
  return columns.map((col) => {
    if (!col.total || !isNumericColumn(col)) return null;
    let sum = new Decimal(0);
    for (const row of counted) {
      const d = toDecimal(rawValue(col, row));
      if (d) sum = sum.plus(d);
    }
    return sum.toNumber();
  });
}

/** Totals formatted for the table footer. The first non-totalled column carries the label. */
export function formatTotalsRow(columns: readonly ReportColumn[], totals: ReadonlyArray<number | null>, label = "Total"): string[] {
  let labelled = false;
  return columns.map((col, i) => {
    const t = totals[i];
    if (t !== null && t !== undefined) return formatValue(col, t);
    if (!labelled) {
      labelled = true;
      return label;
    }
    return "";
  });
}

export function hasTotals(columns: readonly ReportColumn[]): boolean {
  return columns.some((c) => c.total && isNumericColumn(c));
}

/** Rows of display strings for the on-screen table. */
export function buildTableRows(columns: readonly ReportColumn[], rows: readonly ReportRow[]): string[][] {
  return rows.map((row) => columns.map((col) => formatCell(col, row)));
}

/** Headers and rows for `toCsv`. Driven by the same columns as the table. */
export function buildCsv(columns: readonly ReportColumn[], rows: readonly ReportRow[]): { headers: string[]; rows: CsvCell[][] } {
  return {
    headers: columns.map((c) => csvHeader(c)),
    rows: rows.map((row) => columns.map((col) => csvCell(col, row))),
  };
}

/** Money columns say they are in rupees, so the numbers cannot be misread as paise. */
export function csvHeader(col: ReportColumn): string {
  return col.type === "money" ? `${col.header} (Rs)` : col.header;
}

/** "sales-register_2026-11-01_to_2026-11-12.csv" or "stock-summary_2026-11-12.csv". */
export function csvFilename(key: string, range: { from: string; to: string } | null, today: string): string {
  return range ? `${key}_${range.from}_to_${range.to}.csv` : `${key}_${today}.csv`;
}

/** Compact rupees for chart axes: ₹950, ₹45k, ₹1.2L, ₹3.4Cr. */
export function formatCompactINR(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  const sign = paise < 0 ? "-" : "";
  const trim = (n: number) => {
    const s = n >= 100 ? n.toFixed(0) : n.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };
  if (rupees >= 1e7) return `${sign}₹${trim(rupees / 1e7)}Cr`;
  if (rupees >= 1e5) return `${sign}₹${trim(rupees / 1e5)}L`;
  if (rupees >= 1e3) return `${sign}₹${trim(rupees / 1e3)}k`;
  return `${sign}₹${Math.round(rupees)}`;
}

/** "2026-11-12" → "12/11". */
export function formatDayMonth(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
