import { z } from "zod";
import { isValidHsn } from "@/lib/gst/validators";
import { rupeesToPaise } from "@/lib/money";

/**
 * Product CSV import: pure parsing and validation, shared by the browser
 * (instant error report and preview) and the Server Action (which never trusts
 * the browser and runs exactly the same checks again).
 */

export const IMPORT_COLUMNS = [
  "name",
  "sku",
  "barcode",
  "category",
  "hsn_code",
  "unit_code",
  "gst_rate",
  "cess_rate",
  "sale_price",
  "price_includes_tax",
  "mrp",
  "purchase_price",
  "track_inventory",
  "low_stock_threshold",
  "opening_stock",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["name", "sale_price"];

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_CHUNK_SIZE = 200;

export const IMPORT_COLUMN_LABELS: Record<ImportColumn, string> = {
  name: "Name",
  sku: "SKU",
  barcode: "Barcode",
  category: "Category",
  hsn_code: "HSN code",
  unit_code: "Unit",
  gst_rate: "GST rate",
  cess_rate: "Cess rate",
  sale_price: "Selling price",
  price_includes_tax: "Price includes tax",
  mrp: "MRP",
  purchase_price: "Purchase price",
  track_inventory: "Track inventory",
  low_stock_threshold: "Low stock threshold",
  opening_stock: "Opening stock",
};

/** Example row for the downloadable template, in IMPORT_COLUMNS order. */
export const IMPORT_TEMPLATE_EXAMPLE: Record<ImportColumn, string> = {
  name: "Cotton Kurta (M)",
  sku: "KURTA-M-001",
  barcode: "8901234567890",
  category: "Clothing",
  hsn_code: "6205",
  unit_code: "PCS",
  gst_rate: "5",
  cess_rate: "0",
  sale_price: "799.00",
  price_includes_tax: "yes",
  mrp: "999.00",
  purchase_price: "450.00",
  track_inventory: "yes",
  low_stock_threshold: "5",
  opening_stock: "20",
};

// Keys are already normalised with headerKey().
const HEADER_ALIASES: Record<string, ImportColumn> = {
  name: "name",
  product: "name",
  product_name: "name",
  item: "name",
  item_name: "name",
  description: "name",

  sku: "sku",
  sku_code: "sku",
  item_code: "sku",
  product_code: "sku",
  code: "sku",

  barcode: "barcode",
  bar_code: "barcode",
  ean: "barcode",
  upc: "barcode",
  gtin: "barcode",

  category: "category",
  category_name: "category",
  group: "category",

  hsn_code: "hsn_code",
  hsn: "hsn_code",
  hsn_sac: "hsn_code",
  hsn_sac_code: "hsn_code",
  sac: "hsn_code",

  unit_code: "unit_code",
  unit: "unit_code",
  uom: "unit_code",
  uqc: "unit_code",

  gst_rate: "gst_rate",
  gst: "gst_rate",
  gst_percent: "gst_rate",
  gst_rate_percent: "gst_rate",
  tax_rate: "gst_rate",
  tax: "gst_rate",
  tax_percent: "gst_rate",

  cess_rate: "cess_rate",
  cess: "cess_rate",
  cess_percent: "cess_rate",

  sale_price: "sale_price",
  selling_price: "sale_price",
  sales_price: "sale_price",
  price: "sale_price",
  rate: "sale_price",
  sp: "sale_price",

  price_includes_tax: "price_includes_tax",
  price_include_tax: "price_includes_tax",
  includes_tax: "price_includes_tax",
  tax_inclusive: "price_includes_tax",
  inclusive: "price_includes_tax",
  inclusive_of_tax: "price_includes_tax",
  incl_tax: "price_includes_tax",

  mrp: "mrp",
  max_retail_price: "mrp",
  maximum_retail_price: "mrp",

  purchase_price: "purchase_price",
  cost_price: "purchase_price",
  cost: "purchase_price",
  buying_price: "purchase_price",
  cp: "purchase_price",

  track_inventory: "track_inventory",
  track_stock: "track_inventory",
  manage_stock: "track_inventory",

  low_stock_threshold: "low_stock_threshold",
  low_stock: "low_stock_threshold",
  low_stock_alert: "low_stock_threshold",
  reorder_level: "low_stock_threshold",
  min_stock: "low_stock_threshold",

  opening_stock: "opening_stock",
  opening_qty: "opening_stock",
  opening_quantity: "opening_stock",
  stock: "opening_stock",
  quantity: "opening_stock",
  qty: "opening_stock",
};

function headerKey(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/\(.*?\)/g, " ") // "Sale price (₹)" → "Sale price"
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** "Selling Price (₹)" → "sale_price". Null when the header is not a supported column. */
export function normaliseHeader(raw: string): ImportColumn | null {
  return HEADER_ALIASES[headerKey(raw)] ?? null;
}

export interface HeaderMapping {
  /** One entry per file column, in file order. Null = ignored column. */
  columns: Array<ImportColumn | null>;
  /** Headers we do not understand (ignored, shown to the user). */
  unknown: string[];
  /** Required columns that are not in the file. */
  missing: ImportColumn[];
  /** Columns that appear more than once (the first one wins). */
  duplicates: ImportColumn[];
}

export function mapHeaders(headers: string[]): HeaderMapping {
  const seen = new Set<ImportColumn>();
  const unknown: string[] = [];
  const duplicates: ImportColumn[] = [];
  const columns = headers.map((h) => {
    const col = normaliseHeader(h);
    if (!col) {
      if (h.trim()) unknown.push(h.trim());
      return null;
    }
    if (seen.has(col)) {
      if (!duplicates.includes(col)) duplicates.push(col);
      return null;
    }
    seen.add(col);
    return col;
  });
  return { columns, unknown, duplicates, missing: REQUIRED_IMPORT_COLUMNS.filter((c) => !seen.has(c)) };
}

export type RawImportValues = Partial<Record<ImportColumn, string>>;

export interface RawImportRow {
  /** Row number as the user sees it in their spreadsheet (the header is row 1). */
  row: number;
  values: RawImportValues;
}

/** Turn parsed CSV lines (arrays of cells, without the header line) into raw rows. Blank lines are skipped. */
export function toRawRows(mapping: HeaderMapping, lines: string[][]): RawImportRow[] {
  const rows: RawImportRow[] = [];
  lines.forEach((cells, index) => {
    const values: RawImportValues = {};
    let hasValue = false;
    mapping.columns.forEach((col, i) => {
      if (!col) return;
      const cell = String(cells[i] ?? "").trim();
      values[col] = cell;
      if (cell) hasValue = true;
    });
    if (hasValue) rows.push({ row: index + 2, values });
  });
  return rows;
}

const TRUE_WORDS = new Set(["yes", "y", "true", "t", "1", "on", "inclusive", "incl", "included"]);
const FALSE_WORDS = new Set(["no", "n", "false", "f", "0", "off", "exclusive", "excl", "excluded"]);

/** yes/no/true/false/1/0 (any case). `undefined` for blank, `null` when not understood. */
export function parseBoolean(input: string | null | undefined): boolean | null | undefined {
  const v = (input ?? "").trim().toLowerCase();
  if (v === "") return undefined;
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

/** "₹1,234.50", "Rs. 99", "1234" → paise. `undefined` for blank, `null` when not a valid non-negative amount. */
export function parseMoney(input: string | null | undefined): number | null | undefined {
  const raw = (input ?? "").trim();
  if (raw === "") return undefined;
  const cleaned = raw.replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/\s*\/-$/, "");
  if (!/^\d[\d,]*(\.\d+)?$|^\.\d+$/.test(cleaned)) return null;
  const paise = rupeesToPaise(cleaned);
  if (paise === null || paise < 0 || !Number.isSafeInteger(paise) || paise > 99_99_99_999_00) return null;
  return paise;
}

/** "18", "18%", "0.25" → number with at most 2 decimals. `undefined` for blank, `null` when invalid. */
export function parsePercent(input: string | null | undefined): number | null | undefined {
  const raw = (input ?? "").trim();
  if (raw === "") return undefined;
  const cleaned = raw.replace(/\s*%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n >= 0 && n <= 100 ? n : null;
}

/** Quantity with up to 3 decimals, kept as a string. `undefined` for blank, `null` when invalid. */
export function parseQuantity(input: string | null | undefined): string | null | undefined {
  const raw = (input ?? "").trim();
  if (raw === "") return undefined;
  const cleaned = raw.replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(cleaned)) return null;
  return cleaned;
}

const cell = z
  .string()
  .max(500, "Too long")
  .optional()
  .transform((v) => (v ?? "").trim());

function issue(ctx: z.RefinementCtx, column: ImportColumn, message: string) {
  ctx.addIssue({ code: "custom", path: [column], message });
}

/**
 * One CSV row: text cells in, clean typed values out. `null` means "left blank":
 * new products get the default, existing products keep what they have.
 */
export const importRowSchema = z
  .object({
    name: cell,
    sku: cell,
    barcode: cell,
    category: cell,
    hsn_code: cell,
    unit_code: cell,
    gst_rate: cell,
    cess_rate: cell,
    sale_price: cell,
    price_includes_tax: cell,
    mrp: cell,
    purchase_price: cell,
    track_inventory: cell,
    low_stock_threshold: cell,
    opening_stock: cell,
  })
  .transform((v, ctx) => {
    if (!v.name) issue(ctx, "name", "Name is required");
    else if (v.name.length > 150) issue(ctx, "name", "Name is too long (150 characters at most)");

    if (v.sku.length > 64) issue(ctx, "sku", "SKU is too long (64 characters at most)");

    if (v.barcode.length > 64) issue(ctx, "barcode", "Barcode is too long (64 characters at most)");
    else if (/^\d(\.\d+)?e\+?\d+$/i.test(v.barcode)) {
      issue(ctx, "barcode", "The spreadsheet changed this barcode to a number like 8.9E+12. Format the column as Text and enter it again.");
    }

    if (v.category.length > 100) issue(ctx, "category", "Category is too long (100 characters at most)");

    if (v.hsn_code && !isValidHsn(v.hsn_code)) {
      issue(ctx, "hsn_code", "HSN must be 4, 6 or 8 digits. If it starts with 0, format the column as Text so the 0 is kept.");
    }

    const gstRate = parsePercent(v.gst_rate);
    if (gstRate === null) issue(ctx, "gst_rate", "GST rate must be a number like 5 or 18");

    const cessRate = parsePercent(v.cess_rate);
    if (cessRate === null) issue(ctx, "cess_rate", "Cess rate must be a number between 0 and 100");

    const salePrice = parseMoney(v.sale_price);
    if (salePrice === undefined) issue(ctx, "sale_price", "Selling price is required");
    else if (salePrice === null) issue(ctx, "sale_price", "Selling price must be a valid amount");

    const mrp = parseMoney(v.mrp);
    if (mrp === null) issue(ctx, "mrp", "MRP must be a valid amount");
    else if (typeof mrp === "number" && typeof salePrice === "number" && mrp < salePrice) {
      issue(ctx, "mrp", "MRP cannot be less than the selling price");
    }

    const purchasePrice = parseMoney(v.purchase_price);
    if (purchasePrice === null) issue(ctx, "purchase_price", "Purchase price must be a valid amount");

    const includesTax = parseBoolean(v.price_includes_tax);
    if (includesTax === null) issue(ctx, "price_includes_tax", "Use yes or no");

    const trackInventory = parseBoolean(v.track_inventory);
    if (trackInventory === null) issue(ctx, "track_inventory", "Use yes or no");

    const threshold = parseQuantity(v.low_stock_threshold);
    if (threshold === null) issue(ctx, "low_stock_threshold", "Low stock threshold must be a number (up to 3 decimals)");

    const openingStock = parseQuantity(v.opening_stock);
    if (openingStock === null) issue(ctx, "opening_stock", "Opening stock must be a number (up to 3 decimals)");

    return {
      name: v.name,
      sku: v.sku || null,
      barcode: v.barcode || null,
      category: v.category.replace(/\s+/g, " ") || null,
      hsn_code: v.hsn_code || null,
      /** As typed; resolved to a real unit code by validateImportRows(). */
      unit_code: v.unit_code || null,
      gst_rate: gstRate ?? null,
      cess_rate: cessRate ?? null,
      sale_price_paise: salePrice ?? 0,
      price_includes_tax: includesTax ?? null,
      mrp_paise: mrp ?? null,
      purchase_price_paise: purchasePrice ?? null,
      track_inventory: trackInventory ?? null,
      low_stock_threshold: threshold ?? null,
      opening_stock: openingStock ?? null,
    };
  });

export type ImportRowValues = z.output<typeof importRowSchema>;
export type ParsedImportRow = ImportRowValues & { row: number };

export interface ImportRowError {
  row: number;
  column: ImportColumn | "";
  message: string;
}

/** Reference data the rows are checked against (loaded from the `units` and `gst_rates` tables). */
export interface ImportRefs {
  units: Array<{ code: string; name: string }>;
  gstRates: number[];
}

export interface ImportValidation {
  /** Rows with no errors at all, ready to import. */
  valid: ParsedImportRow[];
  errors: ImportRowError[];
  /** Number of rows that have at least one error. */
  invalidRowCount: number;
}

function formatRates(rates: number[]): string {
  return [...rates]
    .sort((a, b) => a - b)
    .map((r) => `${r}%`)
    .join(", ");
}

/**
 * Validate every row: format (importRowSchema), units and GST rates against the
 * reference tables, and duplicate SKUs / barcodes inside the file.
 */
export function validateImportRows(rows: RawImportRow[], refs: ImportRefs): ImportValidation {
  const unitByKey = new Map<string, string>();
  for (const u of refs.units) {
    unitByKey.set(u.code.toLowerCase(), u.code);
    if (!unitByKey.has(u.name.toLowerCase())) unitByKey.set(u.name.toLowerCase(), u.code);
  }
  const rateSet = new Set(refs.gstRates.map((r) => Number(r)));

  const errors: ImportRowError[] = [];
  const candidates: ParsedImportRow[] = [];
  const badRows = new Set<number>();
  const fail = (row: number, column: ImportColumn | "", message: string) => {
    errors.push({ row, column, message });
    badRows.add(row);
  };

  const firstSku = new Map<string, number>();
  const firstBarcode = new Map<string, number>();

  for (const raw of rows) {
    const parsed = importRowSchema.safeParse(raw.values);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const key = String(i.path[0] ?? "");
        const column = (IMPORT_COLUMNS as readonly string[]).includes(key) ? (key as ImportColumn) : "";
        fail(raw.row, column, i.message);
      }
    }
    const value = parsed.success ? parsed.data : null;

    // Reference and duplicate checks also run for rows with format errors, so
    // the report shows everything that is wrong in one go.
    const unitText = (value?.unit_code ?? raw.values.unit_code ?? "").trim();
    let unitCode: string | null = null;
    if (unitText) {
      unitCode = unitByKey.get(unitText.toLowerCase()) ?? null;
      if (!unitCode) fail(raw.row, "unit_code", `Unknown unit "${unitText}". Use a unit code such as PCS, KGS or LTR.`);
    }

    const rate = value ? value.gst_rate : (parsePercent(raw.values.gst_rate) ?? null);
    if (rate !== null && !rateSet.has(rate)) {
      fail(raw.row, "gst_rate", `${rate}% is not a GST rate in use. Allowed: ${formatRates(refs.gstRates)}.`);
    }

    const sku = (value?.sku ?? raw.values.sku ?? "").trim();
    if (sku) {
      const first = firstSku.get(sku);
      if (first !== undefined) fail(raw.row, "sku", `Same SKU as row ${first}. Each SKU can appear only once in the file.`);
      else firstSku.set(sku, raw.row);
    }

    const barcode = (value?.barcode ?? raw.values.barcode ?? "").trim();
    if (barcode) {
      const first = firstBarcode.get(barcode);
      if (first !== undefined) fail(raw.row, "barcode", `Same barcode as row ${first}. Each barcode can appear only once in the file.`);
      else firstBarcode.set(barcode, raw.row);
    }

    if (value) candidates.push({ ...value, unit_code: unitCode, row: raw.row });
  }

  errors.sort((a, b) => a.row - b.row);
  return {
    valid: candidates.filter((c) => !badRows.has(c.row)),
    errors,
    invalidRowCount: badRows.size,
  };
}

export interface ImportRowResult {
  row: number;
  status: "created" | "updated" | "failed";
  /** Why it failed, or a note about something that was skipped. */
  message?: string;
}

export interface ImportChunkResult {
  results: ImportRowResult[];
}

/** Split rows into chunks for the commit action. */
export function chunkRows<T>(rows: T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/** How many rows will create a product and how many will update one, given the SKUs already in the business. */
export function countNewAndUpdates(rows: Array<{ sku: string | null }>, existingSkus: Iterable<string>) {
  const existing = existingSkus instanceof Set ? (existingSkus as Set<string>) : new Set(existingSkus);
  let updates = 0;
  for (const r of rows) if (r.sku && existing.has(r.sku)) updates += 1;
  return { toCreate: rows.length - updates, toUpdate: updates };
}
