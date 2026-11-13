import { describe, expect, it } from "vitest";
import { gstinCheckChar } from "@/lib/gst";
import { purchaseBillSchema, type PurchaseBillInput } from "@/lib/validation/purchases";
import {
  PurchaseComputeError,
  buildPurchasePayload,
  computePurchase,
  isEmptyDraft,
  liveTotals,
  ourStateCode,
  postingProblems,
  resolvePurchaseSupply,
} from "./compute";
import { EMPTY_PREFILL, billToPrefill, prefillToFormValues, rateValue } from "./prefill";

const OUTLET = "11111111-1111-4111-8111-111111111111";
const VENDOR = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const BUSINESS = "44444444-4444-4444-8444-444444444444";
const GSTIN_MH = `27AAACC1206D1Z${gstinCheckChar("27AAACC1206D1Z")}`;

function form(over: Partial<PurchaseBillInput> = {}): PurchaseBillInput {
  return {
    id: "",
    outlet_id: OUTLET,
    vendor_id: VENDOR,
    vendor_invoice_number: " VB-17 ",
    vendor_invoice_date: "2026-04-10",
    is_inter_state: false,
    round_off: "",
    notes: "",
    attachment_paths: [],
    lines: [
      {
        product_id: PRODUCT,
        description: "Pen",
        hsn_code: "9608",
        quantity: "100",
        unit_code: "PCS",
        rate: "5.00",
        price_includes_tax: false,
        discount: "",
        gst_rate: "18",
        cess_rate: "0",
      },
    ],
    ...over,
  };
}

describe("purchaseBillSchema", () => {
  it("turns rupee strings into paise and blanks into nulls", () => {
    const data = purchaseBillSchema.parse(form({ round_off: "-0.40" }));
    expect(data.id).toBeNull();
    expect(data.vendor_invoice_number).toBe("VB-17");
    expect(data.round_off_paise).toBe(-40);
    expect(data.lines[0]).toMatchObject({ rate_paise: 500, discount_paise: 0, gst_rate: 18, cess_rate: 0, quantity: "100" });
  });

  it("accepts a draft that is only an attachment", () => {
    const data = purchaseBillSchema.parse(
      form({ vendor_id: "", vendor_invoice_number: "", vendor_invoice_date: "", lines: [], attachment_paths: [`${BUSINESS}/bills/a.jpg`] }),
    );
    expect(data).toMatchObject({ vendor_id: null, vendor_invoice_number: null, vendor_invoice_date: null, lines: [] });
    expect(isEmptyDraft(data)).toBe(false);
    expect(Object.keys(postingProblems(data)).sort()).toEqual(["lines", "vendor_id", "vendor_invoice_date", "vendor_invoice_number"]);
  });

  it("rejects future dates, impossible dates and a round-off of a rupee or more", () => {
    expect(purchaseBillSchema.safeParse(form({ vendor_invoice_date: "2999-01-01" })).success).toBe(false);
    expect(purchaseBillSchema.safeParse(form({ vendor_invoice_date: "2026-02-31" })).success).toBe(false);
    expect(purchaseBillSchema.safeParse(form({ round_off: "1.00" })).success).toBe(false);
    expect(purchaseBillSchema.safeParse(form({ round_off: "-0.99" })).success).toBe(true);
  });

  it("reports line errors on the line's own field", () => {
    const bad = form();
    bad.lines[0].quantity = "0";
    const result = purchaseBillSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path.join(".")).toBe("lines.0.quantity");
  });

  it("knows an empty draft", () => {
    const data = purchaseBillSchema.parse(form({ vendor_id: "", vendor_invoice_number: "", lines: [] }));
    expect(isEmptyDraft(data)).toBe(true);
  });
});

describe("place of supply for a purchase", () => {
  it("uses the outlet GSTIN, then the business GSTIN, then the outlet address", () => {
    expect(ourStateCode({ gstin: GSTIN_MH, state_code: "24" }, null)).toBe("27");
    expect(ourStateCode({ gstin: null, state_code: "24" }, GSTIN_MH)).toBe("27");
    expect(ourStateCode({ gstin: null, state_code: "24" }, null)).toBe("24");
  });

  it("same state → CGST + SGST, other state → IGST, unknown → CGST + SGST", () => {
    expect(resolvePurchaseSupply("27", { gstin: GSTIN_MH, state_code: null })).toEqual({ ourState: "27", vendorState: "27", isInterState: false });
    expect(resolvePurchaseSupply("24", { gstin: GSTIN_MH, state_code: "24" })).toMatchObject({ vendorState: "27", isInterState: true });
    expect(resolvePurchaseSupply("24", { gstin: null, state_code: "29" })).toMatchObject({ vendorState: "29", isInterState: true });
    expect(resolvePurchaseSupply("24", { gstin: null, state_code: null })).toMatchObject({ vendorState: null, isInterState: false });
    expect(resolvePurchaseSupply("24", null)).toMatchObject({ vendorState: null, isInterState: false });
  });
});

describe("buildPurchasePayload", () => {
  it("matches the shape and numbers save_purchase_bill checks", () => {
    const bill = purchaseBillSchema.parse(form());
    const p = buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "27", bill });
    expect(p).toMatchObject({
      id: null,
      business_id: BUSINESS,
      outlet_id: OUTLET,
      vendor_id: VENDOR,
      vendor_invoice_number: "VB-17",
      vendor_invoice_date: "2026-04-10",
      place_of_supply_state: "27",
      is_inter_state: false,
      subtotal_paise: 500_00,
      discount_paise: 0,
      taxable_paise: 500_00,
      cgst_paise: 45_00,
      sgst_paise: 45_00,
      igst_paise: 0,
      cess_paise: 0,
      round_off_paise: 0,
      total_paise: 590_00,
    });
    expect(p.items[0]).toMatchObject({
      product_id: PRODUCT,
      quantity: "100",
      rate_paise: 500,
      taxable_paise: 500_00,
      cgst_paise: 45_00,
      sgst_paise: 45_00,
      igst_paise: 0,
      total_paise: 590_00,
    });
  });

  it("header totals equal the sum of the lines, and each line adds up (the database constraints)", () => {
    const input = form({ is_inter_state: true, round_off: "0.37" });
    input.lines.push(
      { product_id: "", description: "Freight", hsn_code: "", quantity: "1", unit_code: "NOS", rate: "333.33", price_includes_tax: true, discount: "10.10", gst_rate: "5", cess_rate: "" },
      { product_id: PRODUCT, description: "Cola", hsn_code: "2202", quantity: "2.375", unit_code: "LTR", rate: "99.99", price_includes_tax: false, discount: "", gst_rate: "40", cess_rate: "12" },
    );
    const p = buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "24", bill: purchaseBillSchema.parse(input) });
    const sum = (k: "taxable_paise" | "cgst_paise" | "sgst_paise" | "igst_paise" | "cess_paise") => p.items.reduce((a, i) => a + i[k], 0);
    expect(p.taxable_paise).toBe(sum("taxable_paise"));
    expect(p.igst_paise).toBe(sum("igst_paise"));
    expect(p.cess_paise).toBe(sum("cess_paise"));
    expect(p.cgst_paise + p.sgst_paise).toBe(0);
    for (const i of p.items) {
      expect(i.total_paise).toBe(i.taxable_paise + i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise);
      expect(Number.isInteger(i.total_paise)).toBe(true);
    }
    expect(p.round_off_paise).toBe(37);
    expect(p.total_paise).toBe(p.taxable_paise + p.cgst_paise + p.sgst_paise + p.igst_paise + p.cess_paise + p.round_off_paise);
    expect(p.items[1]).toMatchObject({ product_id: null, discount_paise: 10_10, price_includes_tax: true });
  });

  it("a draft with no lines has zero totals", () => {
    const bill = purchaseBillSchema.parse(form({ lines: [], vendor_id: "", attachment_paths: [`${BUSINESS}/bills/x.pdf`] }));
    const p = buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "27", bill });
    expect(p).toMatchObject({ vendor_id: null, total_paise: 0, taxable_paise: 0, items: [] });
    expect(p.attachment_paths).toEqual([`${BUSINESS}/bills/x.pdf`]);
  });

  it("names the line when the engine refuses it, and refuses a negative total", () => {
    const input = form();
    input.lines[0].discount = "600";
    expect(() => buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "27", bill: purchaseBillSchema.parse(input) })).toThrow(/Line 1: Discount cannot be more/);
    expect(() => computePurchase([], false, -50)).toThrow(PurchaseComputeError);
    expect(() => computePurchase([], false, 100)).toThrow(/Round-off/);
  });
});

describe("liveTotals", () => {
  it("agrees with the server computation for complete lines", () => {
    const input = form({ round_off: "0.40" });
    const live = liveTotals(input.lines, false, input.round_off);
    const p = buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "27", bill: purchaseBillSchema.parse(input) });
    expect(live.totalPaise).toBe(p.total_paise);
    expect(live.taxablePaise).toBe(p.taxable_paise);
    expect(live.cgstPaise).toBe(p.cgst_paise);
    expect(live.incompleteLines).toBe(0);
  });

  it("skips half-typed lines instead of failing", () => {
    const live = liveTotals(
      [
        { quantity: "2", rate: "10", gst_rate: "18" },
        { quantity: "", rate: "10", gst_rate: "18" },
        { quantity: "1", rate: "abc", gst_rate: "18" },
        { quantity: "1", rate: "10", discount: "50", gst_rate: "18" },
        undefined,
      ],
      true,
      "9",
    );
    expect(live.lines.map((l) => l !== null)).toEqual([true, false, false, false, false]);
    expect(live.incompleteLines).toBe(4);
    expect(live.igstPaise).toBe(3_60);
    expect(live.roundOffPaise).toBe(0); // out of range round-off is ignored until fixed
    expect(live.totalPaise).toBe(23_60);
  });
});

describe("draft prefill", () => {
  it("an empty prefill opens a blank form on the given outlet", () => {
    expect(prefillToFormValues(EMPTY_PREFILL, { outletId: OUTLET, isInterState: false })).toEqual({
      id: "",
      outlet_id: OUTLET,
      vendor_id: "",
      vendor_invoice_number: "",
      vendor_invoice_date: "",
      is_inter_state: false,
      round_off: "",
      notes: "",
      attachment_paths: [],
      lines: [],
    });
  });

  it("a saved draft round-trips through the form and the schema", () => {
    const bill = purchaseBillSchema.parse(form({ round_off: "-0.25", is_inter_state: true }));
    const payload = buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "27", bill });
    const prefill = billToPrefill(
      { ...payload, id: "55555555-5555-4555-8555-555555555555" },
      payload.items.map((i) => ({ ...i, gst_rate: "18.00", cess_rate: "0.00", quantity: "100.000" })),
    );
    const values = prefillToFormValues(prefill, { outletId: "other", isInterState: false });
    expect(values).toMatchObject({ outlet_id: OUTLET, is_inter_state: true, round_off: "-0.25" });
    expect(values.lines[0]).toMatchObject({ quantity: "100", rate: "5.00", discount: "", gst_rate: "18", cess_rate: "0" });
    const again = buildPurchasePayload({ businessId: BUSINESS, placeOfSupplyState: "27", bill: purchaseBillSchema.parse(values) });
    expect(again.total_paise).toBe(payload.total_paise);
    expect(again.id).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("formats rates the way the rate select does", () => {
    expect(rateValue("18.00")).toBe("18");
    expect(rateValue(0.25)).toBe("0.25");
    expect(rateValue(null)).toBe("0");
  });
});
