import { describe, expect, it } from "vitest";
import {
  AdjustmentError,
  adjustmentDelta,
  belowThresholdBy,
  isLowStock,
  ledgerCheck,
  movementLabel,
  movementSource,
  runningBalances,
  signedQty,
  stockStatus,
  sumQuantities,
} from "./ledger";
import { adjustStockSchema } from "./validation";

describe("running balance", () => {
  it("is computed in order for a newest-first ledger", () => {
    // oldest → newest: +10 opening, -3 sale, +0.5 return, -7.5 sale
    const newestFirst = [-7.5, 0.5, -3, 10];
    expect(runningBalances(newestFirst)).toEqual(["0", "7.5", "7", "10"]);
  });

  it("does not drift with decimals", () => {
    const deltas = Array.from({ length: 30 }, () => "0.1");
    expect(sumQuantities(deltas)).toBe("3");
    expect(runningBalances(deltas)[0]).toBe("3");
    expect(runningBalances(deltas)[29]).toBe("0.1");
  });

  it("slices line up with pages", () => {
    const all = runningBalances(["-1", "-1", "5", "-2", "10"]);
    expect(all.slice(2, 4)).toEqual(["13", "8"]);
    expect(runningBalances([])).toEqual([]);
  });

  it("checks the ledger against the stored level", () => {
    expect(ledgerCheck([10, -3, "0.5"], "7.500")).toMatchObject({ matches: true, ledgerTotal: "7.5", difference: "0" });
    expect(ledgerCheck([10, -3], 6)).toMatchObject({ matches: false, difference: "1" });
    expect(ledgerCheck([], null)).toMatchObject({ matches: true, ledgerTotal: "0" });
  });
});

describe("stock status", () => {
  it("classifies levels", () => {
    expect(stockStatus(-1, 5)).toBe("negative");
    expect(stockStatus(0, null)).toBe("out");
    expect(stockStatus(null, 5)).toBe("out");
    expect(stockStatus(5, 5)).toBe("low");
    expect(stockStatus("5.001", 5)).toBe("ok");
    expect(stockStatus(1, null)).toBe("ok");
  });

  it("low stock matches the dashboard rule and sorts by shortfall", () => {
    expect(isLowStock(0, 0)).toBe(true);
    expect(isLowStock(3, null)).toBe(false);
    expect(isLowStock(11, 10)).toBe(false);
    const rows = [
      { n: "a", q: 4, t: 5 },
      { n: "b", q: 0, t: 20 },
      { n: "c", q: -2, t: 1 },
    ].sort((x, y) => belowThresholdBy(x.q, x.t) - belowThresholdBy(y.q, y.t));
    expect(rows.map((r) => r.n)).toEqual(["b", "c", "a"]);
  });
});

describe("adjustmentDelta", () => {
  it("set counted quantity computes the difference", () => {
    expect(adjustmentDelta({ mode: "set", quantity: "7", current: 10 })).toBe("-3");
    expect(adjustmentDelta({ mode: "set", quantity: "0", current: "2.5" })).toBe("-2.5");
    expect(adjustmentDelta({ mode: "set", quantity: "4.125", current: null })).toBe("4.125");
    expect(adjustmentDelta({ mode: "set", quantity: "3", current: -2 })).toBe("5");
  });

  it("add / remove", () => {
    expect(adjustmentDelta({ mode: "change", quantity: "2", direction: "add", current: 1 })).toBe("2");
    expect(adjustmentDelta({ mode: "change", quantity: "0.25", direction: "remove", current: 1 })).toBe("-0.25");
  });

  it("refuses a zero or invalid change", () => {
    expect(() => adjustmentDelta({ mode: "set", quantity: "10", current: "10.000" })).toThrow(AdjustmentError);
    expect(() => adjustmentDelta({ mode: "change", quantity: "0", direction: "add", current: 1 })).toThrow(/greater than zero/);
    expect(() => adjustmentDelta({ mode: "change", quantity: "abc", current: 1 })).toThrow(AdjustmentError);
    expect(() => adjustmentDelta({ mode: "set", quantity: "1.2345", current: 1 })).toThrow(AdjustmentError);
    expect(() => adjustmentDelta({ mode: "set", quantity: "-1", current: 1 })).toThrow(AdjustmentError);
  });
});

describe("display helpers", () => {
  it("labels and signs", () => {
    expect(movementLabel("sale_return")).toBe("Sale return");
    expect(movementLabel("mystery")).toBe("mystery");
    expect(signedQty(5)).toBe("+5");
    expect(signedQty("-2.500")).toBe("-2.5");
  });

  it("links a movement to its source document", () => {
    expect(movementSource({ source_table: "sales_invoices", source_id: "s1" })?.href).toBe("/app/sales/s1");
    expect(movementSource({ source_table: "purchase_bills", source_id: "p1" })?.href).toBe("/app/purchases/p1");
    expect(movementSource({ source_table: "credit_notes", source_id: "c1" }, { c1: "inv9" })?.href).toBe("/app/sales/inv9");
    expect(movementSource({ source_table: "credit_notes", source_id: "c1" })).toBeNull();
    expect(movementSource({ source_table: "stock_adjustments", source_id: null })).toBeNull();
    expect(movementSource({ source_table: "products", source_id: "x" })).toBeNull();
  });
});

describe("adjustStockSchema", () => {
  const base = {
    product_id: "33333333-3333-4333-8333-333333333333",
    outlet_id: "11111111-1111-4111-8111-111111111111",
    mode: "change",
    direction: "remove",
    quantity: "2",
    reason: "damage",
    note: "",
  };

  it("requires a reason, and a note for other", () => {
    expect(adjustStockSchema.safeParse(base).success).toBe(true);
    expect(adjustStockSchema.safeParse({ ...base, reason: "" }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, reason: "other" }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, reason: "other", note: "Sample given away" }).success).toBe(true);
  });

  it("allows counting zero but not changing by zero", () => {
    expect(adjustStockSchema.safeParse({ ...base, mode: "set", quantity: "0" }).success).toBe(true);
    expect(adjustStockSchema.safeParse({ ...base, quantity: "0" }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ...base, quantity: "-1" }).success).toBe(false);
  });
});
