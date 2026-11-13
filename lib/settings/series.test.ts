import { describe, expect, it } from "vitest";
import { creditNotePrefixFor, deriveCreditNotePrefix, sampleNumber, suggestInvoicePrefix } from "./series";

describe("series helpers", () => {
  it("derives the credit-note prefix like onboarding does", () => {
    expect(deriveCreditNotePrefix("a")).toBe("ACN");
    expect(deriveCreditNotePrefix("B2")).toBe("B2CN");
    expect(deriveCreditNotePrefix("MUM")).toBe("CMUM");
    expect(deriveCreditNotePrefix("PUNE")).toBe("CPUN");
  });

  it("falls back when the derived credit-note prefix is taken or invalid", () => {
    expect(creditNotePrefixFor("A", [])).toBe("ACN");
    expect(creditNotePrefixFor("A", ["ACN"])).toBe("CA");
    expect(creditNotePrefixFor("A", ["ACN", "CA", "CN"])).toBe("CN1");
    // "CAB-" would end with a hyphen, which is not allowed.
    expect(creditNotePrefixFor("AB-1", [])).toBe("CAB");
    // Never the same as the invoice prefix itself.
    expect(creditNotePrefixFor("CN", ["CNCN", "CCN"])).toBe("CN1");
  });

  it("suggests an unused invoice prefix whose credit-note prefix is also free", () => {
    expect(suggestInvoicePrefix([])).toBe("A");
    expect(suggestInvoicePrefix(["A", "ACN"])).toBe("B");
    expect(suggestInvoicePrefix(["a", "BCN"])).toBe("C");
  });

  it("formats a sample number or returns null", () => {
    expect(sampleNumber("A", "2627", 42)).toBe("A/2627/00042");
    expect(sampleNumber("", "2627", 1)).toBeNull();
    expect(sampleNumber("ABCD", "2627", 1_000_000)).toBeNull();
  });
});
