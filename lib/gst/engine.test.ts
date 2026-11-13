import { describe, expect, it } from "vitest";
import {
  GstEngineError,
  computeInvoice,
  diffTotals,
  discountPercent,
  formatRate,
  lineGross,
  percentOf,
  roundOffToRupee,
  splitIntraState,
  summariseByRate,
  type LineInput,
} from "./engine";

const base = { chargeTax: true, isInterState: false, roundOff: false };
const line = (over: Partial<LineInput> = {}): LineInput => ({
  quantity: 1,
  unitPricePaise: 100_00,
  priceIncludesTax: false,
  gstRate: 18,
  ...over,
});

describe("line calculation: price excludes tax", () => {
  it("adds tax on top of the taxable value", () => {
    const r = computeInvoice({ ...base, lines: [line({ quantity: 2, unitPricePaise: 250_00 })] });
    expect(r.lines[0]).toMatchObject({
      grossPaise: 500_00,
      taxablePaise: 500_00,
      cgstPaise: 45_00,
      sgstPaise: 45_00,
      igstPaise: 0,
      totalPaise: 590_00,
    });
    expect(r.totalPaise).toBe(590_00);
  });

  it("subtracts the line discount before tax", () => {
    const r = computeInvoice({ ...base, lines: [line({ unitPricePaise: 1000_00, discountPaise: 100_00 })] });
    expect(r.lines[0].taxablePaise).toBe(900_00);
    expect(r.lines[0].cgstPaise + r.lines[0].sgstPaise).toBe(162_00);
    expect(r.discountPaise).toBe(100_00);
  });

  it("rounds tax half-up to the paisa", () => {
    // 33.33 × 5% = 1.6665 → 1.67
    const r = computeInvoice({ ...base, lines: [line({ unitPricePaise: 33_33, gstRate: 5 })] });
    expect(r.lines[0].cgstPaise + r.lines[0].sgstPaise).toBe(1_67);
    // 0.50 × 5% = 0.025 → 0.03 (exactly half rounds up)
    const half = computeInvoice({ ...base, lines: [line({ unitPricePaise: 50, gstRate: 5 })] });
    expect(half.lines[0].cgstPaise + half.lines[0].sgstPaise).toBe(3);
  });
});

describe("line calculation: price includes tax", () => {
  it("backs the tax out so taxable + tax = gross exactly", () => {
    const r = computeInvoice({ ...base, lines: [line({ unitPricePaise: 118_00, priceIncludesTax: true })] });
    expect(r.lines[0]).toMatchObject({ taxablePaise: 100_00, cgstPaise: 9_00, sgstPaise: 9_00, totalPaise: 118_00 });
  });

  it("keeps the identity for awkward MRPs at every rate", () => {
    for (const gstRate of [0, 0.25, 3, 5, 12, 18, 28, 40]) {
      for (const unitPricePaise of [1, 99, 1_00, 9_99, 49_99, 199_00, 1_234_57, 99_999_99]) {
        const r = computeInvoice({
          ...base,
          lines: [line({ unitPricePaise, gstRate, priceIncludesTax: true, quantity: "3" })],
        });
        const l = r.lines[0];
        expect(l.taxablePaise + l.cgstPaise + l.sgstPaise).toBe(l.grossPaise);
        expect(l.totalPaise).toBe(unitPricePaise * 3);
      }
    }
  });

  it("applies the discount to the tax-inclusive amount", () => {
    const r = computeInvoice({
      ...base,
      lines: [line({ unitPricePaise: 1180_00, priceIncludesTax: true, discountPaise: 118_00 })],
    });
    expect(r.lines[0]).toMatchObject({ taxablePaise: 900_00, totalPaise: 1062_00 });
  });
});

describe("intra-state vs inter-state", () => {
  it("splits odd paise without losing one: CGST floor, SGST the rest", () => {
    expect(splitIntraState(101)).toEqual({ cgstPaise: 50, sgstPaise: 51 });
    expect(splitIntraState(0)).toEqual({ cgstPaise: 0, sgstPaise: 0 });
    // 10.05 × 18% = 1.809 → 1.81 → 0.90 + 0.91
    const r = computeInvoice({ ...base, lines: [line({ unitPricePaise: 10_05 })] });
    expect(r.lines[0]).toMatchObject({ cgstPaise: 90, sgstPaise: 91, igstPaise: 0 });
  });

  it("charges the full rate as IGST across states", () => {
    const r = computeInvoice({ ...base, isInterState: true, lines: [line({ unitPricePaise: 10_05 })] });
    expect(r.lines[0]).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 1_81 });
    expect(r.igstPaise).toBe(1_81);
    expect(r.cgstPaise).toBe(0);
  });

  it("gives the same total either way", () => {
    const lines = [line({ unitPricePaise: 333_33 }), line({ unitPricePaise: 77_77, gstRate: 5, quantity: "2.5" })];
    const intra = computeInvoice({ ...base, lines });
    const inter = computeInvoice({ ...base, isInterState: true, lines });
    expect(intra.totalPaise).toBe(inter.totalPaise);
    expect(intra.cgstPaise + intra.sgstPaise).toBe(inter.igstPaise);
  });
});

describe("bill-level discount", () => {
  it("spreads across lines in proportion to their value before tax", () => {
    const r = computeInvoice({
      ...base,
      billDiscountPaise: 100_00,
      lines: [line({ unitPricePaise: 300_00 }), line({ unitPricePaise: 700_00, gstRate: 5 })],
    });
    expect(r.lines.map((l) => l.billDiscountPaise)).toEqual([30_00, 70_00]);
    expect(r.lines.map((l) => l.taxablePaise)).toEqual([270_00, 630_00]);
    expect(r.discountPaise).toBe(100_00);
  });

  it("never loses or invents a paisa when the split is uneven", () => {
    const r = computeInvoice({
      ...base,
      billDiscountPaise: 1_00,
      lines: [line({ unitPricePaise: 10_00 }), line({ unitPricePaise: 10_00 }), line({ unitPricePaise: 10_00 })],
    });
    const shares = r.lines.map((l) => l.billDiscountPaise);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1_00);
    expect(shares).toEqual([34, 33, 33]);
  });

  it("stacks on top of line discounts", () => {
    const r = computeInvoice({
      ...base,
      billDiscountPaise: 50_00,
      lines: [line({ unitPricePaise: 600_00, discountPaise: 100_00 }), line({ unitPricePaise: 500_00 })],
    });
    expect(r.lines[0]).toMatchObject({ lineDiscountPaise: 100_00, billDiscountPaise: 25_00, discountPaise: 125_00 });
    expect(r.subtotalPaise).toBe(1100_00);
    expect(r.discountPaise).toBe(150_00);
    expect(r.taxablePaise).toBe(950_00);
  });

  it("rejects a discount larger than the bill", () => {
    expect(() => computeInvoice({ ...base, billDiscountPaise: 101_00, lines: [line()] })).toThrow(GstEngineError);
    expect(() => computeInvoice({ ...base, lines: [line({ discountPaise: 100_01 })] })).toThrow(/Discount cannot/);
  });
});

describe("round-off", () => {
  it("rounds the grand total to the nearest rupee, half-up", () => {
    expect(roundOffToRupee(100_49)).toEqual({ roundedPaise: 100_00, roundOffPaise: -49 });
    expect(roundOffToRupee(100_50)).toEqual({ roundedPaise: 101_00, roundOffPaise: 50 });
    expect(roundOffToRupee(100_00)).toEqual({ roundedPaise: 100_00, roundOffPaise: 0 });
  });

  it("stores the adjustment and keeps the totals identity", () => {
    const r = computeInvoice({ ...base, roundOff: true, lines: [line({ unitPricePaise: 33_33, gstRate: 5 })] });
    expect(r.taxablePaise + r.taxPaise).toBe(35_00);
    const r2 = computeInvoice({ ...base, roundOff: true, lines: [line({ unitPricePaise: 99_99 })] });
    expect(r2.taxablePaise + r2.taxPaise).toBe(117_99);
    expect(r2.roundOffPaise).toBe(1);
    expect(r2.totalPaise).toBe(118_00);
    expect(r2.taxablePaise + r2.taxPaise + r2.roundOffPaise).toBe(r2.totalPaise);
  });

  it("is zero when disabled", () => {
    const r = computeInvoice({ ...base, lines: [line({ unitPricePaise: 99_99 })] });
    expect(r.roundOffPaise).toBe(0);
    expect(r.totalPaise).toBe(117_99);
  });
});

describe("cess", () => {
  it("is charged on the taxable value for tax-exclusive prices", () => {
    const r = computeInvoice({ ...base, lines: [line({ unitPricePaise: 1000_00, gstRate: 28, cessRate: 12 })] });
    expect(r.lines[0]).toMatchObject({ taxablePaise: 1000_00, cgstPaise: 140_00, sgstPaise: 140_00, cessPaise: 120_00 });
    expect(r.totalPaise).toBe(1400_00);
  });

  it("is backed out together with GST for tax-inclusive prices", () => {
    const r = computeInvoice({
      ...base,
      lines: [line({ unitPricePaise: 1400_00, gstRate: 28, cessRate: 12, priceIncludesTax: true })],
    });
    expect(r.lines[0]).toMatchObject({ taxablePaise: 1000_00, cessPaise: 120_00, totalPaise: 1400_00 });
    expect(r.cessPaise).toBe(120_00);
  });

  it("keeps taxable + gst + cess = gross for awkward inclusive prices", () => {
    const r = computeInvoice({
      ...base,
      lines: [line({ unitPricePaise: 99_99, gstRate: 40, cessRate: 3, priceIncludesTax: true, quantity: "7" })],
    });
    const l = r.lines[0];
    expect(l.taxablePaise + l.cgstPaise + l.sgstPaise + l.cessPaise).toBe(l.grossPaise);
  });
});

describe("zero-rated lines and non-taxable sellers", () => {
  it("charges nothing on a 0% line", () => {
    const r = computeInvoice({ ...base, lines: [line({ gstRate: 0 }), line({ gstRate: 0, priceIncludesTax: true })] });
    expect(r.taxPaise).toBe(0);
    expect(r.totalPaise).toBe(200_00);
  });

  it("ignores product tax rates when the seller does not charge tax", () => {
    const r = computeInvoice({
      ...base,
      chargeTax: false,
      lines: [line({ unitPricePaise: 118_00, priceIncludesTax: true }), line({ gstRate: 5, cessRate: 1 })],
    });
    expect(r.taxPaise).toBe(0);
    expect(r.taxablePaise).toBe(218_00);
    expect(r.lines[0].gstRate).toBe("0.00");
  });
});

describe("quantities", () => {
  it("handles fractional quantities (weights) with half-up rounding", () => {
    expect(lineGross("0.125", 99_99)).toBe(12_50); // 12.49875 → 12.50
    expect(lineGross("1.005", 1_00)).toBe(1_01); // 100.5 → 101
    const r = computeInvoice({ ...base, lines: [line({ quantity: "0.250", unitPricePaise: 480_00, gstRate: 5 })] });
    expect(r.lines[0]).toMatchObject({ grossPaise: 120_00, cgstPaise: 3_00, sgstPaise: 3_00 });
  });

  it("rejects bad input", () => {
    expect(() => computeInvoice({ ...base, lines: [line({ quantity: 0 })] })).toThrow(/greater than zero/);
    expect(() => computeInvoice({ ...base, lines: [line({ quantity: "1.2345" })] })).toThrow(/3 decimal/);
    expect(() => computeInvoice({ ...base, lines: [line({ quantity: "abc" })] })).toThrow(/not a number/);
    expect(() => computeInvoice({ ...base, lines: [line({ unitPricePaise: 10.5 })] })).toThrow(/whole number/);
    expect(() => computeInvoice({ ...base, lines: [line({ gstRate: 101 })] })).toThrow(/between 0 and 100/);
    expect(() => computeInvoice({ ...base, lines: [line({ gstRate: "x" })] })).toThrow(/not a number/);
    expect(() => computeInvoice({ ...base, lines: [line({ discountPaise: -1 })] })).toThrow(/non-negative/);
    expect(() => computeInvoice({ ...base, billDiscountPaise: -5, lines: [line()] })).toThrow(/non-negative/);
    try {
      computeInvoice({ ...base, lines: [line(), line({ quantity: -1 })] });
    } catch (e) {
      expect((e as GstEngineError).lineIndex).toBe(1);
    }
  });

  it("returns zero totals for an empty bill", () => {
    const r = computeInvoice({ ...base, roundOff: true, lines: [] });
    expect(r.totalPaise).toBe(0);
    expect(r.lines).toEqual([]);
  });
});

describe("totals", () => {
  it("are the sum of the lines", () => {
    const r = computeInvoice({
      ...base,
      roundOff: true,
      billDiscountPaise: 13_37,
      lines: [
        line({ quantity: 3, unitPricePaise: 49_99, priceIncludesTax: true, gstRate: 5 }),
        line({ quantity: "1.75", unitPricePaise: 220_00, gstRate: 18, discountPaise: 10_00 }),
        line({ quantity: 12, unitPricePaise: 10_00, gstRate: 0 }),
        line({ quantity: 1, unitPricePaise: 2499_00, priceIncludesTax: true, gstRate: 40, cessRate: 1 }),
      ],
    });
    const s = (k: "taxablePaise" | "cgstPaise" | "sgstPaise" | "igstPaise" | "cessPaise" | "totalPaise") =>
      r.lines.reduce((a, l) => a + l[k], 0);
    expect(r.taxablePaise).toBe(s("taxablePaise"));
    expect(r.cgstPaise).toBe(s("cgstPaise"));
    expect(r.sgstPaise).toBe(s("sgstPaise"));
    expect(r.cessPaise).toBe(s("cessPaise"));
    expect(r.totalPaise - r.roundOffPaise).toBe(s("totalPaise"));
    expect(r.totalPaise % 100).toBe(0);
    expect(r.subtotalPaise - r.discountPaise).toBe(
      r.lines.reduce((a, l) => a + l.grossPaise - l.discountPaise, 0),
    );
  });

  it("is deterministic: client and server agree", () => {
    const input = { ...base, roundOff: true, lines: [line({ unitPricePaise: 77_77 }), line({ gstRate: "5.00" })] };
    expect(diffTotals(computeInvoice(input), computeInvoice(structuredClone(input)))).toEqual([]);
  });

  it("reports which totals differ", () => {
    const a = computeInvoice({ ...base, lines: [line()] });
    expect(diffTotals(a, { ...a, totalPaise: a.totalPaise + 1 })).toEqual(["totalPaise"]);
    expect(diffTotals(a, { ...a, totalPaise: a.totalPaise + 1 }, 1)).toEqual([]);
  });
});

describe("helpers", () => {
  it("percentOf and discountPercent", () => {
    expect(percentOf(999_99, 10)).toBe(100_00);
    expect(percentOf(100_00, "12.5")).toBe(12_50);
    expect(discountPercent(50_00, 1000_00)).toBe(5);
    expect(discountPercent(10_00, 0)).toBe(0);
    expect(discountPercent(1_00, 300_00)).toBe(0.33);
  });

  it("summarises tax by rate, lowest first", () => {
    const r = computeInvoice({
      ...base,
      lines: [line({ gstRate: 18 }), line({ gstRate: 5 }), line({ gstRate: "18.00", unitPricePaise: 50_00 })],
    });
    const summary = summariseByRate(r.lines);
    expect(summary.map((s) => s.gstRate)).toEqual(["5.00", "18.00"]);
    expect(summary[1]).toMatchObject({ taxablePaise: 150_00, cgstPaise: 13_50, sgstPaise: 13_50 });
  });

  it("formats rates", () => {
    expect(formatRate("18.00")).toBe("18%");
    expect(formatRate(0.25)).toBe("0.25%");
    expect(formatRate("0")).toBe("0%");
  });
});
