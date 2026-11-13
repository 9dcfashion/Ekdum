import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/list";
import {
  buildCsv,
  buildTableRows,
  computeTotals,
  csvFilename,
  csvValue,
  formatCompactINR,
  formatDayMonth,
  formatTotalsRow,
  formatValue,
  hasTotals,
  type ReportColumn,
} from "./format";
import { getReport, REPORTS } from "./definitions";
import { parseFilters } from "./filters";

const money: ReportColumn = { key: "total_paise", header: "Total", type: "money", total: true };
const qty: ReportColumn = { key: "quantity", header: "Qty", type: "qty" };
const date: ReportColumn = { key: "d", header: "Date", type: "date" };
const state: ReportColumn = { key: "s", header: "State", type: "state" };
const text: ReportColumn = { key: "status", header: "Status", type: "text", labels: { posted: "Posted" } };
const bool: ReportColumn = { key: "b", header: "Flag", type: "boolean" };

describe("formatValue (table)", () => {
  it("formats money with Indian grouping and no symbol", () => {
    expect(formatValue(money, 12345600)).toBe("1,23,456.00");
    expect(formatValue(money, "250")).toBe("2.50");
    expect(formatValue(money, 0)).toBe("0.00");
    expect(formatValue(money, -150)).toBe("-1.50");
  });
  it("formats quantities, dates, states, labels and booleans", () => {
    expect(formatValue(qty, 2.5)).toBe("2.5");
    expect(formatValue(qty, "4.000")).toBe("4");
    expect(formatValue(date, "2026-11-01")).toBe("01/11/2026");
    expect(formatValue(state, "27")).toBe("Maharashtra (27)");
    expect(formatValue(state, "ZZ")).toBe("ZZ");
    expect(formatValue(text, "posted")).toBe("Posted");
    expect(formatValue(text, "other")).toBe("other");
    expect(formatValue(bool, true)).toBe("Yes");
    expect(formatValue(bool, false)).toBe("No");
  });
  it("formats timestamps in IST", () => {
    const col: ReportColumn = { key: "t", header: "When", type: "datetime" };
    // 18:30Z on 31 March is midnight on 1 April in IST.
    expect(formatValue(col, "2026-03-31T18:30:00Z")).toMatch(/^01\/04\/2026, 12:00/);
  });
  it("shows nothing for missing values", () => {
    for (const col of [money, qty, date, state, text, bool]) {
      expect(formatValue(col, null)).toBe("");
      expect(formatValue(col, undefined)).toBe("");
    }
    expect(formatValue(money, "abc")).toBe("");
  });
});

describe("csvValue", () => {
  it("writes rupees as plain decimals", () => {
    expect(csvValue(money, 123450)).toBe("1234.50");
    expect(csvValue(money, 0)).toBe("0.00");
    expect(csvValue(money, "99")).toBe("0.99");
  });
  it("keeps negative amounts numeric so the formula guard does not quote them", () => {
    expect(csvValue(money, -150)).toBe(-1.5);
    expect(toCsv(["Round off (Rs)"], [[csvValue(money, -150)]])).toContain("\r\n-1.5\r\n");
    expect(csvValue(qty, "-2.000")).toBe(-2);
  });
  it("writes dates as DD/MM/YYYY and states with names", () => {
    expect(csvValue(date, "2026-11-12")).toBe("12/11/2026");
    expect(csvValue(state, "29")).toBe("Karnataka (29)");
  });
  it("writes null for missing values", () => {
    expect(csvValue(money, null)).toBeNull();
    expect(csvValue(qty, undefined)).toBeNull();
    expect(csvValue(text, "")).toBeNull();
  });
});

describe("totals", () => {
  const columns = [text, qty, money];
  const rows = [
    { status: "posted", quantity: 1, total_paise: 10050 },
    { status: "cancelled", quantity: 2, total_paise: 99900 },
    { status: "posted", quantity: 3, total_paise: "25" },
    { status: "posted", quantity: 1, total_paise: null },
  ];
  it("sums only the columns marked total", () => {
    expect(computeTotals(columns, rows)).toEqual([null, null, 109975]);
  });
  it("can leave rows out (cancelled documents)", () => {
    expect(computeTotals(columns, rows, (r) => r.status === "posted")).toEqual([null, null, 10075]);
  });
  it("is zero for no rows and has no float drift", () => {
    expect(computeTotals(columns, [])).toEqual([null, null, 0]);
    const q: ReportColumn = { ...qty, total: true };
    expect(computeTotals([q], [{ quantity: 0.1 }, { quantity: 0.2 }])).toEqual([0.3]);
  });
  it("labels the footer in the first free column", () => {
    expect(formatTotalsRow(columns, [null, null, 10075], "Total (posted bills)")).toEqual(["Total (posted bills)", "", "100.75"]);
    expect(hasTotals(columns)).toBe(true);
    expect(hasTotals([text, qty])).toBe(false);
  });
});

describe("table and CSV come from the same definition", () => {
  it("has one cell per column in both", () => {
    const def = getReport("sales-register")!;
    const row = {
      invoice_date: "2026-11-01",
      invoice_number: "A/2627/00001",
      document_type: "tax_invoice",
      status: "posted",
      outlet_name: "Main",
      customer_name: "=HYPERLINK(1)",
      customer_phone: null,
      customer_gstin: null,
      supply_type: "b2c",
      place_of_supply_state: "27",
      is_inter_state: false,
      subtotal_paise: 10000,
      discount_paise: 0,
      taxable_paise: 10000,
      cgst_paise: 900,
      sgst_paise: 900,
      igst_paise: 0,
      cess_paise: 0,
      round_off_paise: -20,
      total_paise: 11780,
      amount_due_paise: 0,
      payment_modes: "cash, upi",
      billed_by: "Asha",
      source: "pos_online",
    };
    const table = buildTableRows(def.columns, [row]);
    const csv = buildCsv(def.columns, [row]);
    expect(table[0]).toHaveLength(def.columns.length);
    expect(csv.headers).toHaveLength(def.columns.length);
    expect(csv.rows[0]).toHaveLength(def.columns.length);

    const at = (key: string) => def.columns.findIndex((c) => c.key === key);
    expect(table[0][at("payment_modes")]).toBe("Cash, UPI");
    expect(table[0][at("supply_type")]).toBe("B2C");
    expect(table[0][at("place_of_supply_state")]).toBe("Maharashtra (27)");
    expect(csv.rows[0][at("total_paise")]).toBe("117.80");
    expect(csv.rows[0][at("round_off_paise")]).toBe(-0.2);
    expect(csv.rows[0][at("invoice_date")]).toBe("01/11/2026");
    expect(csv.headers[at("total_paise")]).toBe("Total (Rs)");

    const text = toCsv(csv.headers, csv.rows);
    expect(text.startsWith("﻿")).toBe(true);
    expect(text).toContain("'=HYPERLINK(1)");
  });

  it("every definition is well formed", () => {
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length);
    for (const def of REPORTS) {
      expect(def.rpc).toMatch(/^report_/);
      expect(new Set(def.columns.map((c) => c.key)).size).toBe(def.columns.length);
      for (const col of def.columns) {
        if (col.total) expect(["money", "qty", "number"]).toContain(col.type);
        if (col.key.endsWith("_paise")) expect(col.type).toBe("money");
      }
    }
    expect(getReport("stock-summary")?.hasDates).toBe(false);
    expect(getReport("purchase-register")?.requires).toBe("purchases.view");
    expect(getReport("nope")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("builds file names", () => {
    expect(csvFilename("sales-register", { from: "2026-11-01", to: "2026-11-12" }, "2026-11-12")).toBe(
      "sales-register_2026-11-01_to_2026-11-12.csv",
    );
    expect(csvFilename("stock-summary", null, "2026-11-12")).toBe("stock-summary_2026-11-12.csv");
  });
  it("formats compact rupees", () => {
    expect(formatCompactINR(0)).toBe("₹0");
    expect(formatCompactINR(95000)).toBe("₹950");
    expect(formatCompactINR(4500000)).toBe("₹45k");
    expect(formatCompactINR(12000000)).toBe("₹1.2L");
    expect(formatCompactINR(3400000000)).toBe("₹3.4Cr");
  });
  it("formats axis days", () => {
    expect(formatDayMonth("2026-11-02")).toBe("02/11");
  });
});

describe("parseFilters", () => {
  const now = new Date("2026-11-12T06:00:00Z");
  it("uses the default preset and all outlets", () => {
    expect(parseFilters({}, ["o1"], "30d", now)).toEqual({
      preset: "30d",
      from: "2026-10-14",
      to: "2026-11-12",
      outletId: null,
      clamped: false,
    });
  });
  it("ignores outlets the user cannot access and unknown presets", () => {
    const f = parseFilters({ outlet: "other", range: "forever" }, ["o1"], "today", now);
    expect(f.outletId).toBeNull();
    expect(f.preset).toBe("today");
    expect(parseFilters({ outlet: "o1" }, ["o1"], "today", now).outletId).toBe("o1");
  });
  it("shortens custom ranges that are too long", () => {
    const f = parseFilters({ range: "custom", from: "2020-01-01", to: "2026-11-12" }, [], "today", now);
    expect(f.to).toBe("2026-11-12");
    expect(f.from).toBe("2025-10-08");
    expect(f.clamped).toBe(true);
  });
});
