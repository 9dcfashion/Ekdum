import { describe, expect, it } from "vitest";
import {
  PLACE_OF_SUPPLY_STATES,
  SELECTABLE_STATES,
  amountInWords,
  chargesTax,
  displayHsn,
  formatInvoiceNumber,
  formatMobile,
  getState,
  gstinCheckChar,
  isInterState,
  isValidGstin,
  isValidHsn,
  isValidIfsc,
  isValidMobile,
  isValidPan,
  isValidPincode,
  isValidStateCode,
  isValidUpiId,
  maskAccountNumber,
  maxSequenceForPrefix,
  normaliseGstin,
  normaliseMobile,
  numberToIndianWords,
  parseInvoiceNumber,
  resolveDocumentType,
  resolvePlaceOfSupply,
  sellerStateCode,
  stateLabel,
  stateName,
  upiPaymentUri,
  validateGstin,
  validateSeriesPrefix,
} from "./index";

describe("GSTIN", () => {
  const VALID = "27AAPFU0939F1ZV";

  it("computes the mod-36 check character", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(() => gstinCheckChar("27AAPFU0939F1*")).toThrow();
  });

  it("accepts a valid GSTIN and derives state and PAN", () => {
    expect(validateGstin(VALID)).toEqual({ valid: true, gstin: VALID, stateCode: "27", pan: "AAPFU0939F" });
    expect(isValidGstin(" 27aapfu0939f1zv ")).toBe(true);
    expect(normaliseGstin("27 aapfu 0939f1zv")).toBe(VALID);
  });

  it("rejects a wrong check digit (single-character typo)", () => {
    expect(validateGstin("27AAPFU0939F1ZW").error).toBe("checksum");
    expect(validateGstin("27AAPFU0939G1ZV").error).toBe("checksum");
  });

  it("rejects wrong length, format and state", () => {
    expect(validateGstin("27AAPFU0939F1Z").error).toBe("length");
    expect(validateGstin("").error).toBe("length");
    expect(validateGstin(null).error).toBe("length");
    expect(validateGstin("27AAPFU0939F1YV").error).toBe("format");
    expect(validateGstin("2712345093901ZV").error).toBe("format");
    const unknownState = "00AAPFU0939F1Z";
    expect(validateGstin(unknownState + gstinCheckChar(unknownState)).error).toBe("state");
    expect(validateGstin("27AAPFU0939F1ZW").message).toMatch(/check digit/);
  });

  it("validates every state prefix with a generated check digit", () => {
    for (const s of ["07", "09", "29", "33", "36", "38", "97"]) {
      const body = `${s}ABCDE1234F1Z`;
      expect(validateGstin(body + gstinCheckChar(body))).toMatchObject({ valid: true, stateCode: s });
    }
  });
});

describe("states", () => {
  it("knows states, UTs and special codes", () => {
    expect(stateName("27")).toBe("Maharashtra");
    expect(stateLabel("07")).toBe("Delhi (07)");
    expect(getState("97")?.special).toBe(true);
    expect(isValidStateCode("38")).toBe(true);
    expect(isValidStateCode("28")).toBe(false);
    expect(isValidStateCode("")).toBe(false);
    expect(stateName(null)).toBe("");
    expect(stateLabel("xx")).toBe("");
  });

  it("offers the right lists in pickers", () => {
    expect(SELECTABLE_STATES.some((s) => s.code === "97")).toBe(false);
    expect(SELECTABLE_STATES.some((s) => s.code === "25")).toBe(false);
    expect(PLACE_OF_SUPPLY_STATES.some((s) => s.code === "97")).toBe(true);
    expect(PLACE_OF_SUPPLY_STATES.some((s) => s.code === "99")).toBe(false);
    expect(SELECTABLE_STATES).toHaveLength(36);
  });
});

describe("format validators", () => {
  it("PAN", () => {
    expect(isValidPan("AAPFU0939F")).toBe(true);
    expect(isValidPan("aapfu0939f")).toBe(true);
    expect(isValidPan("AAPFU0939")).toBe(false);
    expect(isValidPan("1APFU0939F")).toBe(false);
    expect(isValidPan(null)).toBe(false);
  });

  it("IFSC", () => {
    expect(isValidIfsc("HDFC0001234")).toBe(true);
    expect(isValidIfsc("sbin0abc123")).toBe(true);
    expect(isValidIfsc("HDFC1001234")).toBe(false);
    expect(isValidIfsc("HDF0001234")).toBe(false);
  });

  it("pincode", () => {
    expect(isValidPincode("400001")).toBe(true);
    expect(isValidPincode("012345")).toBe(false);
    expect(isValidPincode("40001")).toBe(false);
    expect(isValidPincode(undefined)).toBe(false);
  });

  it("mobile numbers normalise to +91XXXXXXXXXX", () => {
    for (const input of ["9876543210", "98765 43210", "+91 98765-43210", "919876543210", "09876543210"]) {
      expect(normaliseMobile(input)).toBe("+919876543210");
    }
    expect(normaliseMobile("5876543210")).toBeNull();
    expect(normaliseMobile("98765432")).toBeNull();
    expect(normaliseMobile("")).toBeNull();
    expect(isValidMobile("6000000000")).toBe(true);
    expect(formatMobile("+919876543210")).toBe("98765 43210");
    expect(formatMobile("junk")).toBe("junk");
    expect(formatMobile(null)).toBe("");
  });

  it("UPI, HSN and masking", () => {
    expect(isValidUpiId("shop.name@okhdfcbank")).toBe(true);
    expect(isValidUpiId("9876543210@ybl")).toBe(true);
    expect(isValidUpiId("no-at-sign")).toBe(false);
    expect(isValidHsn("6109")).toBe(true);
    expect(isValidHsn("610910")).toBe(true);
    expect(isValidHsn("61091000")).toBe(true);
    expect(isValidHsn("61091")).toBe(false);
    expect(displayHsn("61091000", 4)).toBe("6109");
    expect(displayHsn("61091000", 6)).toBe("610910");
    expect(displayHsn("6109", 6)).toBe("6109");
    expect(displayHsn(null)).toBe("");
    expect(maskAccountNumber("50100123456789")).toBe("••••••••6789");
    expect(maskAccountNumber("1234")).toBe("1234");
    expect(maskAccountNumber(null)).toBe("");
  });
});

describe("amount in words (Indian system)", () => {
  it("matches the spec example", () => {
    expect(amountInWords(1_23_456_50)).toBe(
      "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only",
    );
  });

  it("handles small, round and large values", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(5)).toBe("Rupees Zero and Five Paise Only");
    expect(amountInWords(1_00)).toBe("Rupees One Only");
    expect(amountInWords(19_99)).toBe("Rupees Nineteen and Ninety-Nine Paise Only");
    expect(amountInWords(100_00)).toBe("Rupees One Hundred Only");
    expect(amountInWords(1_000_00)).toBe("Rupees One Thousand Only");
    expect(amountInWords(1_00_000_00)).toBe("Rupees One Lakh Only");
    expect(amountInWords(1_00_00_000_00)).toBe("Rupees One Crore Only");
    expect(amountInWords(12_34_56_789_00)).toBe(
      "Rupees Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine Only",
    );
    expect(amountInWords(110_10)).toBe("Rupees One Hundred Ten and Ten Paise Only");
    expect(amountInWords(-250_00)).toBe("Minus Rupees Two Hundred Fifty Only");
  });

  it("goes past 100 crore", () => {
    expect(numberToIndianWords(1_23_45_67_890)).toBe(
      "One Hundred Twenty-Three Crore Forty-Five Lakh Sixty-Seven Thousand Eight Hundred Ninety",
    );
    expect(numberToIndianWords(10_000_000_000)).toBe("One Thousand Crore");
  });

  it("rejects non-integers", () => {
    expect(() => amountInWords(10.5)).toThrow();
    expect(() => numberToIndianWords(-1)).toThrow();
  });
});

describe("invoice numbering", () => {
  it("formats {PREFIX}/{FY}/{SEQ}", () => {
    expect(formatInvoiceNumber("C1", "2627", 42)).toBe("C1/2627/00042");
    expect(formatInvoiceNumber(" a ", "2627", 1)).toBe("A/2627/00001");
    expect(formatInvoiceNumber("ABCD", "2627", 999999)).toBe("ABCD/2627/999999");
  });

  it("never exceeds 16 characters", () => {
    expect(() => formatInvoiceNumber("ABCD", "2627", 1_000_000)).toThrow(/longer than 16/);
    expect(maxSequenceForPrefix("ABCD")).toBe(999_999);
    expect(maxSequenceForPrefix("A")).toBe(999_999_999);
    expect(formatInvoiceNumber("A", "2627", maxSequenceForPrefix("A")).length).toBe(16);
  });

  it("rejects bad input", () => {
    expect(() => formatInvoiceNumber("C1", "2627", 0)).toThrow();
    expect(() => formatInvoiceNumber("C1", "26-27", 1)).toThrow();
    expect(() => formatInvoiceNumber("C_1", "2627", 1)).toThrow(/not allowed/);
  });

  it("validates prefixes", () => {
    expect(validateSeriesPrefix("C1")).toBeNull();
    expect(validateSeriesPrefix("cn-1")).toBeNull();
    expect(validateSeriesPrefix("")).toMatch(/required/);
    expect(validateSeriesPrefix("ABCDE")).toMatch(/at most 4/);
    expect(validateSeriesPrefix("A/B")).toMatch(/only letters/);
    expect(validateSeriesPrefix("-A")).toMatch(/hyphen/);
  });

  it("parses numbers back", () => {
    expect(parseInvoiceNumber("C1/2627/00042")).toEqual({ prefix: "C1", fy: "2627", sequence: 42 });
    expect(parseInvoiceNumber("C1/2627/42")).toBeNull();
    expect(parseInvoiceNumber("c1/2627/00042")).toBeNull();
    expect(parseInvoiceNumber("ABCD/2627/1234567")).toBeNull();
    expect(parseInvoiceNumber("C1/2627/00000")).toBeNull();
  });
});

describe("document type and place of supply", () => {
  it("picks the document from the GST scheme", () => {
    const args = { lineGstRates: [18, 5], bosForExemptOnly: true };
    expect(resolveDocumentType({ ...args, scheme: "regular" })).toBe("tax_invoice");
    expect(resolveDocumentType({ ...args, scheme: "composition" })).toBe("bill_of_supply");
    expect(resolveDocumentType({ ...args, scheme: "unregistered" })).toBe("cash_memo");
    expect(chargesTax("regular")).toBe(true);
    expect(chargesTax("composition")).toBe(false);
    expect(chargesTax("unregistered")).toBe(false);
  });

  it("turns an all-exempt regular sale into a bill of supply when configured", () => {
    expect(resolveDocumentType({ scheme: "regular", lineGstRates: [0, "0.00"], bosForExemptOnly: true })).toBe(
      "bill_of_supply",
    );
    expect(resolveDocumentType({ scheme: "regular", lineGstRates: [0, 0], bosForExemptOnly: false })).toBe(
      "tax_invoice",
    );
    expect(resolveDocumentType({ scheme: "regular", lineGstRates: [0, 5], bosForExemptOnly: true })).toBe(
      "tax_invoice",
    );
    expect(resolveDocumentType({ scheme: "regular", lineGstRates: [], bosForExemptOnly: true })).toBe("tax_invoice");
  });

  it("uses the outlet GSTIN's state as the seller state", () => {
    expect(sellerStateCode({ gstin: "27AAPFU0939F1ZV", state_code: "24" })).toBe("27");
    expect(sellerStateCode({ gstin: null, state_code: "24" })).toBe("24");
    expect(sellerStateCode({ gstin: "bad", state_code: "24" })).toBe("24");
  });

  it("resolves place of supply in priority order", () => {
    const b = { sellerState: "27", supplyType: "b2c" as const };
    expect(resolvePlaceOfSupply(b)).toEqual({ stateCode: "27", source: "outlet" });
    expect(resolvePlaceOfSupply({ ...b, customerStateCode: "24" })).toEqual({ stateCode: "27", source: "outlet" });
    expect(resolvePlaceOfSupply({ ...b, deliveryStateCode: "24" })).toEqual({ stateCode: "24", source: "delivery" });
    expect(resolvePlaceOfSupply({ ...b, deliveryStateCode: "24", overrideStateCode: "29" })).toEqual({
      stateCode: "29",
      source: "override",
    });
    const body = "29ABCDE1234F1Z";
    const gstin = body + gstinCheckChar(body);
    expect(
      resolvePlaceOfSupply({ sellerState: "27", supplyType: "b2b", customerGstin: gstin, customerStateCode: "24" }),
    ).toEqual({ stateCode: "29", source: "customer_gstin" });
    expect(resolvePlaceOfSupply({ sellerState: "27", supplyType: "b2b", customerStateCode: "24" })).toEqual({
      stateCode: "24",
      source: "customer_state",
    });
    expect(resolvePlaceOfSupply({ sellerState: "27", supplyType: "b2b" })).toEqual({
      stateCode: "27",
      source: "outlet",
    });
  });

  it("decides inter-state", () => {
    expect(isInterState("27", "27")).toBe(false);
    expect(isInterState("27", "24")).toBe(true);
  });

  it("builds a UPI payment URI for the exact amount", () => {
    const uri = upiPaymentUri({ upiId: "shop@okhdfcbank", payeeName: "Sharma Stores", amountPaise: 1234_50, note: "A/2627/00001" });
    expect(uri).toContain("upi://pay?");
    expect(uri).toContain("pa=shop%40okhdfcbank");
    expect(uri).toContain("am=1234.50");
    expect(uri).toContain("cu=INR");
    expect(upiPaymentUri({ upiId: "a@b", payeeName: "X" })).not.toContain("am=");
  });
});
