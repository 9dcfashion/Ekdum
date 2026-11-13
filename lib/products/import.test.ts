import { describe, expect, it } from "vitest";
import {
  IMPORT_COLUMNS,
  IMPORT_TEMPLATE_EXAMPLE,
  chunkRows,
  countNewAndUpdates,
  importRowSchema,
  mapHeaders,
  normaliseHeader,
  parseBoolean,
  parseMoney,
  parsePercent,
  parseQuantity,
  toRawRows,
  validateImportRows,
  type ImportRefs,
  type RawImportRow,
  type RawImportValues,
} from "./import";

const refs: ImportRefs = {
  units: [
    { code: "PCS", name: "Pieces" },
    { code: "KGS", name: "Kilograms" },
  ],
  gstRates: [0, 0.25, 3, 5, 18, 40],
};

const row = (n: number, values: RawImportValues): RawImportRow => ({
  row: n,
  values: { name: "Item", sale_price: "100", ...values },
});

describe("header aliases", () => {
  it("maps canonical names", () => {
    for (const c of IMPORT_COLUMNS) expect(normaliseHeader(c)).toBe(c);
  });

  it("maps common aliases, any case and punctuation", () => {
    expect(normaliseHeader("Product Name")).toBe("name");
    expect(normaliseHeader(" Item Code ")).toBe("sku");
    expect(normaliseHeader("HSN/SAC")).toBe("hsn_code");
    expect(normaliseHeader("GST %")).toBe("gst_rate");
    expect(normaliseHeader("Selling Price (₹)")).toBe("sale_price");
    expect(normaliseHeader("Price")).toBe("sale_price");
    expect(normaliseHeader("Cost Price")).toBe("purchase_price");
    expect(normaliseHeader("UOM")).toBe("unit_code");
    expect(normaliseHeader("Tax Inclusive")).toBe("price_includes_tax");
    expect(normaliseHeader("Reorder level")).toBe("low_stock_threshold");
    expect(normaliseHeader("Qty")).toBe("opening_stock");
    expect(normaliseHeader("﻿name")).toBe("name");
  });

  it("returns null for unknown headers", () => {
    expect(normaliseHeader("Colour")).toBeNull();
    expect(normaliseHeader("")).toBeNull();
  });

  it("reports unknown, missing and repeated columns", () => {
    const m = mapHeaders(["Name", "Colour", "SKU", "Item Code", ""]);
    expect(m.columns).toEqual(["name", null, "sku", null, null]);
    expect(m.unknown).toEqual(["Colour"]);
    expect(m.duplicates).toEqual(["sku"]);
    expect(m.missing).toEqual(["sale_price"]);
  });

  it("builds raw rows with spreadsheet row numbers and skips blank lines", () => {
    const m = mapHeaders(["Name", "Price", "Colour"]);
    const rows = toRawRows(m, [
      ["Pen", " 10 ", "Blue"],
      ["", "", "Red"],
      ["Book", "50"],
    ]);
    expect(rows).toEqual([
      { row: 2, values: { name: "Pen", sale_price: "10" } },
      { row: 4, values: { name: "Book", sale_price: "50" } },
    ]);
  });
});

describe("booleans", () => {
  it("understands yes/no/true/false/1/0", () => {
    for (const v of ["yes", "YES", "y", "true", "TRUE", "1", " Yes "]) expect(parseBoolean(v)).toBe(true);
    for (const v of ["no", "No", "n", "false", "FALSE", "0"]) expect(parseBoolean(v)).toBe(false);
  });

  it("returns undefined for blank and null for anything else", () => {
    expect(parseBoolean("")).toBeUndefined();
    expect(parseBoolean("  ")).toBeUndefined();
    expect(parseBoolean(undefined)).toBeUndefined();
    expect(parseBoolean("maybe")).toBeNull();
    expect(parseBoolean("2")).toBeNull();
  });
});

describe("money", () => {
  it("parses rupees into paise", () => {
    expect(parseMoney("100")).toBe(100_00);
    expect(parseMoney("99.5")).toBe(99_50);
    expect(parseMoney("1,23,456.78")).toBe(1_23_456_78);
    expect(parseMoney("₹ 1,234.50")).toBe(1_234_50);
    expect(parseMoney("Rs. 250")).toBe(250_00);
    expect(parseMoney("INR 10")).toBe(10_00);
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney(".5")).toBe(50);
    expect(parseMoney("10.005")).toBe(10_01);
  });

  it("rejects text, negatives and nonsense", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("1.2.3")).toBeNull();
    expect(parseMoney("10 rupees")).toBeNull();
    expect(parseMoney("1e5")).toBeNull();
  });

  it("returns undefined for blank", () => {
    expect(parseMoney("")).toBeUndefined();
    expect(parseMoney(null)).toBeUndefined();
  });
});

describe("percent and quantity", () => {
  it("parses rates", () => {
    expect(parsePercent("18")).toBe(18);
    expect(parsePercent("18%")).toBe(18);
    expect(parsePercent("0.25")).toBe(0.25);
    expect(parsePercent("")).toBeUndefined();
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("five")).toBeNull();
    expect(parsePercent("-5")).toBeNull();
  });

  it("parses quantities with up to 3 decimals", () => {
    expect(parseQuantity("10")).toBe("10");
    expect(parseQuantity("1,000")).toBe("1000");
    expect(parseQuantity("2.125")).toBe("2.125");
    expect(parseQuantity("")).toBeUndefined();
    expect(parseQuantity("2.1255")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("ten")).toBeNull();
  });
});

describe("importRowSchema", () => {
  it("accepts the template example row", () => {
    const parsed = importRowSchema.parse(IMPORT_TEMPLATE_EXAMPLE);
    expect(parsed).toEqual({
      name: "Cotton Kurta (M)",
      sku: "KURTA-M-001",
      barcode: "8901234567890",
      category: "Clothing",
      hsn_code: "6205",
      unit_code: "PCS",
      gst_rate: 5,
      cess_rate: 0,
      sale_price_paise: 799_00,
      price_includes_tax: true,
      mrp_paise: 999_00,
      purchase_price_paise: 450_00,
      track_inventory: true,
      low_stock_threshold: "5",
      opening_stock: "20",
    });
  });

  it("turns blank optional cells into null", () => {
    const parsed = importRowSchema.parse({ name: " Pen ", sale_price: "10" });
    expect(parsed.name).toBe("Pen");
    expect(parsed.sku).toBeNull();
    expect(parsed.gst_rate).toBeNull();
    expect(parsed.price_includes_tax).toBeNull();
    expect(parsed.mrp_paise).toBeNull();
    expect(parsed.opening_stock).toBeNull();
  });

  it("requires a name and a selling price", () => {
    const result = importRowSchema.safeParse({ name: "", sale_price: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toEqual(["name", "sale_price"]);
    }
  });

  it("flags barcodes mangled by a spreadsheet", () => {
    const result = importRowSchema.safeParse({ name: "Pen", sale_price: "10", barcode: "8.90123E+12" });
    expect(result.success).toBe(false);
  });
});

describe("validateImportRows", () => {
  it("passes clean rows and resolves units by code or name", () => {
    const result = validateImportRows(
      [row(2, { unit_code: "pcs", gst_rate: "18%" }), row(3, { unit_code: "Kilograms", gst_rate: "0.25" }), row(4, {})],
      refs,
    );
    expect(result.errors).toEqual([]);
    expect(result.invalidRowCount).toBe(0);
    expect(result.valid.map((r) => r.unit_code)).toEqual(["PCS", "KGS", null]);
    expect(result.valid.map((r) => r.row)).toEqual([2, 3, 4]);
  });

  it("reports a bad HSN", () => {
    const result = validateImportRows([row(2, { hsn_code: "123" }), row(3, { hsn_code: "61091000" })], refs);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2, column: "hsn_code" });
    expect(result.errors[0].message).toContain("HSN must be 4, 6 or 8 digits");
    expect(result.valid.map((r) => r.row)).toEqual([3]);
  });

  it("reports an unknown unit", () => {
    const result = validateImportRows([row(2, { unit_code: "CRATE" })], refs);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2, column: "unit_code" });
    expect(result.errors[0].message).toContain("CRATE");
    expect(result.valid).toEqual([]);
  });

  it("reports an unknown GST rate", () => {
    const result = validateImportRows([row(2, { gst_rate: "12" }), row(3, { gst_rate: "18" })], refs);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 2, column: "gst_rate" });
    expect(result.errors[0].message).toContain("12%");
    expect(result.errors[0].message).toContain("0%, 0.25%, 3%, 5%, 18%, 40%");
    expect(result.valid.map((r) => r.row)).toEqual([3]);
  });

  it("reports duplicate SKUs inside the file", () => {
    const result = validateImportRows([row(2, { sku: "A1" }), row(3, { sku: "B1" }), row(4, { sku: " A1 " })], refs);
    expect(result.errors).toEqual([
      { row: 4, column: "sku", message: "Same SKU as row 2. Each SKU can appear only once in the file." },
    ]);
    expect(result.valid.map((r) => r.row)).toEqual([2, 3]);
  });

  it("reports duplicate barcodes inside the file", () => {
    const result = validateImportRows([row(2, { barcode: "890" }), row(3, { barcode: "890" })], refs);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 3, column: "barcode" });
  });

  it("does not treat blank SKUs or barcodes as duplicates", () => {
    const result = validateImportRows([row(2, {}), row(3, {}), row(4, { sku: "" })], refs);
    expect(result.errors).toEqual([]);
    expect(result.valid).toHaveLength(3);
  });

  it("collects every error of a row and counts bad rows once", () => {
    const result = validateImportRows(
      [row(2, { name: "", sale_price: "abc", unit_code: "XX", gst_rate: "7", price_includes_tax: "maybe" })],
      refs,
    );
    expect(result.invalidRowCount).toBe(1);
    expect(result.errors.map((e) => e.column).sort()).toEqual(
      ["gst_rate", "name", "price_includes_tax", "sale_price", "unit_code"].sort(),
    );
    expect(result.valid).toEqual([]);
  });
});

describe("helpers", () => {
  it("chunks rows", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 2)).toEqual([]);
  });

  it("counts new products and updates by SKU", () => {
    expect(countNewAndUpdates([{ sku: "A" }, { sku: "B" }, { sku: null }], ["A", "Z"])).toEqual({
      toCreate: 2,
      toUpdate: 1,
    });
  });
});
