import { describe, expect, it } from "vitest";
import { allocateProportionally, formatINR, formatQty, paiseToRupees, roundPaise, rupeesToPaise, sumPaise } from "./index";
import {
  addDays,
  financialYear,
  financialYearLabel,
  formatDate,
  formatDateTime,
  istDateString,
  resolveDateRange,
} from "@/lib/dates";

describe("money", () => {
  it("rounds half-up to the paisa", () => {
    expect(roundPaise("0.5")).toBe(1);
    expect(roundPaise("0.4999")).toBe(0);
    expect(roundPaise("1.5")).toBe(2);
    expect(roundPaise("2.5")).toBe(3);
    expect(roundPaise("-0.5")).toBe(-1);
    expect(roundPaise("-1.4")).toBe(-1);
    expect(roundPaise(7)).toBe(7);
  });

  it("converts rupee input to paise without float drift", () => {
    expect(rupeesToPaise("1234.50")).toBe(123450);
    expect(rupeesToPaise("₹1,23,456.78")).toBe(12345678);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(rupeesToPaise("19.99")).toBe(1999);
    expect(rupeesToPaise("1.005")).toBe(101);
    expect(rupeesToPaise("10")).toBe(1000);
    expect(rupeesToPaise(".5")).toBe(50);
    expect(rupeesToPaise("-5")).toBe(-500);
  });

  it("returns null for non-numbers", () => {
    for (const bad of ["", "abc", "1.2.3", "-", ".", null, undefined]) {
      expect(rupeesToPaise(bad)).toBeNull();
    }
  });

  it("formats in the Indian system", () => {
    expect(formatINR(12345600)).toBe("₹1,23,456.00");
    expect(formatINR(1_00_00_000_00)).toBe("₹1,00,00,000.00");
    expect(formatINR(5)).toBe("₹0.05");
    expect(formatINR(null)).toBe("₹0.00");
    expect(formatINR(12345650, { symbol: false })).toBe("1,23,456.50");
    expect(paiseToRupees(123450)).toBe("1234.50");
    expect(paiseToRupees(5)).toBe("0.05");
  });

  it("formats quantities", () => {
    expect(formatQty("2.000")).toBe("2");
    expect(formatQty("1.250")).toBe("1.25");
    expect(formatQty(1500)).toBe("1,500");
    expect(formatQty(null)).toBe("0");
  });

  it("sums and allocates exactly", () => {
    expect(sumPaise([1, 2, 3])).toBe(6);
    expect(sumPaise([])).toBe(0);
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(10, [0, 5, 5])).toEqual([0, 5, 5]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(50, [0, 0])).toEqual([0, 0]);
    const parts = allocateProportionally(9999, [3333, 1, 6666, 12345]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(9999);
  });
});

describe("dates (IST)", () => {
  it("takes the calendar date in IST, not UTC", () => {
    expect(istDateString("2026-03-31T18:29:59Z")).toBe("2026-03-31");
    expect(istDateString("2026-03-31T18:30:00Z")).toBe("2026-04-01");
    expect(istDateString("2026-11-12T00:00:00+05:30")).toBe("2026-11-12");
  });

  it("computes the financial year (April to March)", () => {
    expect(financialYear("2026-04-01")).toBe("2627");
    expect(financialYear("2027-03-31")).toBe("2627");
    expect(financialYear("2026-03-31")).toBe("2526");
    expect(financialYear("2026-11-12")).toBe("2627");
    expect(financialYear("2099-12-01")).toBe("9900");
    // 31 March 23:59 IST is still the old year; one minute later it is the new one.
    expect(financialYear(new Date("2026-03-31T18:29:00Z"))).toBe("2526");
    expect(financialYear(new Date("2026-03-31T18:30:00Z"))).toBe("2627");
    expect(financialYearLabel("2627")).toBe("2026-27");
  });

  it("formats DD/MM/YYYY", () => {
    expect(formatDate("2026-11-02")).toBe("02/11/2026");
    expect(formatDate(new Date("2026-11-02T20:00:00Z"))).toBe("03/11/2026");
    expect(formatDate(null)).toBe("");
    expect(formatDateTime("2026-11-02T08:05:00Z")).toMatch(/^02\/11\/2026, 01:35 pm$/i);
    expect(formatDateTime(null)).toBe("");
  });

  it("resolves dashboard ranges", () => {
    const now = new Date("2026-11-12T10:00:00+05:30");
    expect(resolveDateRange("today", undefined, now)).toEqual({ from: "2026-11-12", to: "2026-11-12" });
    expect(resolveDateRange("yesterday", undefined, now)).toEqual({ from: "2026-11-11", to: "2026-11-11" });
    expect(resolveDateRange("7d", undefined, now)).toEqual({ from: "2026-11-06", to: "2026-11-12" });
    expect(resolveDateRange("30d", undefined, now)).toEqual({ from: "2026-10-14", to: "2026-11-12" });
    expect(resolveDateRange("custom", { from: "2026-11-10", to: "2026-11-01" }, now)).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
    });
    expect(resolveDateRange("custom", { from: "garbage" }, now)).toEqual({ from: "2026-11-12", to: "2026-11-12" });
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
