import { describe, expect, it } from "vitest";
import { MAX_ROUND_OFF_PAISE } from "@/lib/validation/purchases";
import {
  PAPER_TOTAL_TOLERANCE_PAISE,
  canDecreaseQuantity,
  checkPaperTotal,
  dateChoice,
  filterVendors,
  firstIncompleteStep,
  firstStepWithError,
  isBlankBill,
  isLineReady,
  isPhotoOnly,
  orderVendorsByRecent,
  paperTotalHint,
  parseStep,
  rankRecentProducts,
  stepCompleteness,
  stepForField,
  stepQuantity,
  supplierStepProblems,
  type FlowBill,
  type FlowLine,
} from "./flow";

const line = (over: Partial<FlowLine> = {}): FlowLine => ({
  product_id: "p1",
  description: "Pen",
  quantity: "10",
  rate: "5",
  price_includes_tax: false,
  discount: "",
  gst_rate: "18",
  cess_rate: "0",
  ...over,
});

const complete: FlowBill = {
  id: "",
  vendor_id: "v1",
  vendor_invoice_number: "A-17",
  vendor_invoice_date: "2026-11-12",
  attachment_paths: ["b/bills/x.jpg"],
  lines: [line()],
};

describe("steps", () => {
  it("parses the step in the URL", () => {
    expect(parseStep("3")).toBe(3);
    expect(parseStep("0")).toBeNull();
    expect(parseStep("5")).toBeNull();
    expect(parseStep("two")).toBeNull();
    expect(parseStep(null)).toBeNull();
  });

  it("a line is ready only when it has a name and can be priced", () => {
    expect(isLineReady(line())).toBe(true);
    expect(isLineReady(line({ description: "  " }))).toBe(false);
    expect(isLineReady(line({ quantity: "0" }))).toBe(false);
    expect(isLineReady(line({ quantity: "1.2345" }))).toBe(false);
    expect(isLineReady(line({ rate: "" }))).toBe(false);
    expect(isLineReady(line({ discount: "100" }))).toBe(false); // more than the line
    expect(isLineReady(undefined)).toBe(false);
  });

  it("knows which steps are complete", () => {
    expect(stepCompleteness(complete)).toEqual({ photo: true, supplier: true, items: true });
    expect(stepCompleteness({ ...complete, attachment_paths: [], vendor_invoice_date: "" })).toEqual({ photo: false, supplier: false, items: true });
    expect(stepCompleteness({ ...complete, lines: [] }).items).toBe(false);
    expect(stepCompleteness({ ...complete, lines: [line(), line({ rate: "" })] }).items).toBe(false);
  });

  it("opens a new bill at the photo and a draft at the first step that needs work", () => {
    expect(firstIncompleteStep({ id: "", attachment_paths: [], lines: [] })).toBe(1);
    expect(firstIncompleteStep({ attachment_paths: ["x.jpg"], lines: [] })).toBe(2);
    expect(firstIncompleteStep({ ...complete, vendor_invoice_number: "" })).toBe(2);
    expect(firstIncompleteStep({ ...complete, lines: [] })).toBe(3);
    expect(firstIncompleteStep({ ...complete, lines: [line({ quantity: "" })] })).toBe(3);
    expect(firstIncompleteStep(complete)).toBe(4);
    // A saved draft never goes back to the optional photo step.
    expect(firstIncompleteStep({ ...complete, id: "b1", attachment_paths: [] })).toBe(4);
    expect(firstIncompleteStep({ id: "b1", attachment_paths: [], lines: [] })).toBe(2);
  });

  it("knows a blank bill and a photo-only bill", () => {
    expect(isBlankBill({})).toBe(true);
    expect(isBlankBill({ id: "b1" })).toBe(false);
    expect(isBlankBill({ vendor_invoice_date: "2026-11-12" })).toBe(false);
    expect(isPhotoOnly({ attachment_paths: ["x.jpg"], lines: [] })).toBe(true);
    expect(isPhotoOnly({ attachment_paths: ["x.jpg"], vendor_id: "v1" })).toBe(false);
    expect(isPhotoOnly({ attachment_paths: [], lines: [] })).toBe(false);
  });

  it("lists what the supplier step still needs", () => {
    expect(supplierStepProblems(complete)).toEqual({});
    expect(Object.keys(supplierStepProblems({ vendor_invoice_number: " " })).sort()).toEqual([
      "vendor_id",
      "vendor_invoice_date",
      "vendor_invoice_number",
    ]);
  });

  it("maps a field to the step that shows it", () => {
    expect(stepForField("attachment_paths")).toBe(1);
    expect(stepForField("vendor_id")).toBe(2);
    expect(stepForField("outlet_id")).toBe(2);
    expect(stepForField("lines")).toBe(3);
    expect(stepForField("lines.2.gst_rate")).toBe(3);
    expect(stepForField("round_off")).toBe(4);
    expect(stepForField("notes")).toBe(4);
    expect(firstStepWithError(["notes", "lines.0.rate", "_form"])).toBe(3);
    expect(firstStepWithError(["_form"])).toBeNull();
  });
});

describe("total on the paper bill", () => {
  const check = (paperTotal: string, beforeRoundOffPaise: number, roundOffPaise = 0) =>
    checkPaperTotal({ paperTotal, beforeRoundOffPaise, roundOffPaise });

  it("is empty or invalid until a real amount is typed", () => {
    expect(check("", 590_00)).toEqual({ kind: "empty" });
    expect(check("  ", 590_00)).toEqual({ kind: "empty" });
    expect(check("abc", 590_00)).toEqual({ kind: "invalid" });
    expect(check("-5", 590_00)).toEqual({ kind: "invalid" });
  });

  it("matches exactly, with or without a round-off already set", () => {
    expect(check("590", 590_00)).toEqual({ kind: "match" });
    expect(check("1,234.00", 1233_60, 40)).toEqual({ kind: "match" });
  });

  it("offers a one-tap round-off within what the server accepts", () => {
    expect(check("1234", 1233_60)).toEqual({ kind: "round_off", differencePaise: 40, roundOffPaise: 40 });
    expect(check("1233", 1233_60)).toEqual({ kind: "round_off", differencePaise: -60, roundOffPaise: -60 });
    // A wrong round-off already in the form is replaced, not added to.
    expect(check("1234", 1233_60, -20)).toEqual({ kind: "round_off", differencePaise: 60, roundOffPaise: 40 });
    // Back to no round-off at all.
    expect(check("1233.60", 1233_60, 40)).toEqual({ kind: "round_off", differencePaise: -40, roundOffPaise: 0 });
    expect(check(`${(1000_00 + MAX_ROUND_OFF_PAISE) / 100}`, 1000_00)).toMatchObject({ kind: "round_off", roundOffPaise: MAX_ROUND_OFF_PAISE });
  });

  it("calls a few rupees 'small' and more than the tolerance 'big'", () => {
    expect(check("1002.40", 1000_00)).toEqual({ kind: "small", differencePaise: 2_40 });
    expect(check(`${(1000_00 - PAPER_TOTAL_TOLERANCE_PAISE) / 100}`, 1000_00)).toEqual({ kind: "small", differencePaise: -PAPER_TOTAL_TOLERANCE_PAISE });
    expect(check("1005.01", 1000_00)).toEqual({ kind: "big", differencePaise: 5_01 });
    expect(check("1180", 1000_00)).toEqual({ kind: "big", differencePaise: 180_00 });
    expect(check("100", 0)).toEqual({ kind: "big", differencePaise: 100_00 });
  });

  it("never offers a round-off larger than the server rule, even if asked to", () => {
    expect(checkPaperTotal({ paperTotal: "1003", beforeRoundOffPaise: 1000_00, roundOffPaise: 0, maxRoundOffPaise: 500 })).toEqual({
      kind: "small",
      differencePaise: 3_00,
    });
  });

  it("spots rates that already include GST (or do not)", () => {
    const lines = [line({ quantity: "100", rate: "5" })]; // 500 + 18% = 590
    expect(paperTotalHint(lines, false, 500_00)).toBe("rates_include_gst");
    expect(paperTotalHint(lines, false, 590_00)).toBeNull();
    expect(paperTotalHint([line({ quantity: "100", rate: "5", price_includes_tax: true })], false, 590_00)).toBe("rates_exclude_gst");
    expect(paperTotalHint(lines, false, 2000_00)).toBeNull();
    expect(paperTotalHint([], false, 500_00)).toBeNull();
    // An unfinished line means the check cannot be trusted.
    expect(paperTotalHint([...lines, line({ rate: "" })], false, 500_00)).toBeNull();
  });
});

describe("suppliers", () => {
  const vendors = [
    { id: "a", name: "Zeta Traders", gstin: "27AAACZ1234A1Z5", phone: "+91 98200 11111" },
    { id: "b", name: "Alpha Agencies", gstin: null, phone: null },
    { id: "c", name: "Mehta & Sons", gstin: null, phone: "022-2345-6789" },
    { id: "d", name: "Big Alpha Store", gstin: null, phone: null },
  ];

  it("puts the latest suppliers first, without repeats, and the rest A to Z", () => {
    const { recent, others } = orderVendorsByRecent(vendors, ["c", null, "c", "x-deleted", "a", "b"], 2);
    expect(recent.map((v) => v.id)).toEqual(["c", "a"]);
    expect(others.map((v) => v.name)).toEqual(["Alpha Agencies", "Big Alpha Store"]);
  });

  it("with no history everyone is in A to Z order", () => {
    const { recent, others } = orderVendorsByRecent(vendors, []);
    expect(recent).toEqual([]);
    expect(others.map((v) => v.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("searches by name start, word start, GSTIN and phone digits", () => {
    expect(filterVendors(vendors, "alpha").map((v) => v.id)).toEqual(["b", "d"]);
    expect(filterVendors(vendors, "SONS").map((v) => v.id)).toEqual(["c"]);
    expect(filterVendors(vendors, "aacz").map((v) => v.id)).toEqual(["a"]);
    expect(filterVendors(vendors, "98200").map((v) => v.id)).toEqual(["a"]);
    expect(filterVendors(vendors, "2345").map((v) => v.id)).toEqual(["c"]);
    expect(filterVendors(vendors, "  ").length).toBe(4);
    expect(filterVendors(vendors, "nobody")).toEqual([]);
  });
});

describe("items", () => {
  it("ranks recently bought products newest bill first, in bill order, once each", () => {
    const ids = rankRecentProducts(
      ["b2", "b1"],
      [
        { purchase_bill_id: "b1", product_id: "p1", line_no: 1 },
        { purchase_bill_id: "b2", product_id: "p3", line_no: 2 },
        { purchase_bill_id: "b2", product_id: "p2", line_no: 1 },
        { purchase_bill_id: "b1", product_id: "p2", line_no: 2 },
        { purchase_bill_id: "b1", product_id: null, line_no: 3 },
        { purchase_bill_id: "zz", product_id: "p9", line_no: 1 },
      ],
    );
    expect(ids).toEqual(["p2", "p3", "p1"]);
    expect(rankRecentProducts(["b1"], [{ purchase_bill_id: "b1", product_id: "p1", line_no: 1 }, { purchase_bill_id: "b1", product_id: "p2", line_no: 2 }], 1)).toEqual(["p1"]);
  });

  it("steps the quantity without going to zero", () => {
    expect(stepQuantity("1", 1)).toBe("2");
    expect(stepQuantity("2.5", 1)).toBe("3.5");
    expect(stepQuantity("2", -1)).toBe("1");
    expect(stepQuantity("1", -1)).toBe("1");
    expect(stepQuantity("0.5", -1)).toBe("0.5");
    expect(stepQuantity("", 1)).toBe("1");
    expect(stepQuantity("abc", -1)).toBe("1");
    expect(canDecreaseQuantity("2")).toBe(true);
    expect(canDecreaseQuantity("1")).toBe(false);
    expect(canDecreaseQuantity("0.5")).toBe(false);
    expect(canDecreaseQuantity("x")).toBe(false);
  });

  it("names the bill date choice", () => {
    expect(dateChoice("2026-11-13", "2026-11-13")).toBe("today");
    expect(dateChoice("2026-11-12", "2026-11-13")).toBe("yesterday");
    expect(dateChoice("2026-10-31", "2026-11-01")).toBe("yesterday");
    expect(dateChoice("2026-11-01", "2026-11-13")).toBe("other");
    expect(dateChoice("", "2026-11-13")).toBe("none");
  });
});
