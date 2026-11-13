import { describe, expect, it } from "vitest";
import { COMPOSITION_DECLARATION } from "@/lib/gst/config";
import { fixtureBundle, fixtureItem } from "./fixtures";
import { isPublicTokenShape, isUuid } from "./token";
import { buildInvoiceView } from "./view";

describe("buildInvoiceView", () => {
  it("builds an intra-state tax invoice with CGST and SGST", () => {
    const view = buildInvoiceView(fixtureBundle());
    expect(view.title).toBe("Tax Invoice");
    expect(view.number).toBe("A/2627/00042");
    expect(view.date).toBe("12/11/2026");
    expect(view.showTax).toBe(true);
    expect(view.showGstFields).toBe(true);
    expect(view.interState).toBe(false);
    expect(view.seller.name).toBe("Sharma Kirana");
    expect(view.seller.legalName).toBe("Sharma Traders Private Limited");
    expect(view.seller.gstin).toBe("27AAPFU0939F1ZV");
    expect(view.seller.state).toBe("Maharashtra (27)");
    expect(view.seller.addressLines).toEqual(["12 MG Road", "Pune - 411001"]);
    expect(view.placeOfSupply).toBe("Maharashtra (27)");
    expect(view.reverseCharge).toBe("No");
    expect(view.lines).toHaveLength(2);
    expect(view.lines[0]).toMatchObject({
      quantity: "2",
      unit: "PCS",
      gstRate: "18%",
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      taxablePaise: 100000,
      totalPaise: 118000,
    });
    expect(view.totals).toMatchObject({ taxablePaise: 200000, cgstPaise: 18000, sgstPaise: 18000, igstPaise: 0, totalPaise: 236000 });
    expect(view.taxSummary).toHaveLength(1);
    expect(view.taxSummary[0]).toMatchObject({ rateLabel: "18%", taxablePaise: 200000, cgstPaise: 18000, sgstPaise: 18000 });
    expect(view.amountInWords).toBe("Rupees Two Thousand Three Hundred Sixty Only");
    expect(view.declaration).toBeNull();
    expect(view.signatoryFor).toBe("For Sharma Kirana");
    expect(view.signatoryLabel).toBe("Authorised Signatory");
    expect(view.terms).toEqual(["Goods once sold will not be taken back.", "Subject to Pune jurisdiction."]);
    expect(view.footer).toBe("Thank you. Visit again!");
    expect(view.bank).toMatchObject({
      bankName: "State Bank of India",
      accountNumber: "123456789012",
      accountNumberMasked: "••••••••9012",
      ifsc: "SBIN0001234",
    });
  });

  it("builds an inter-state tax invoice with IGST", () => {
    const view = buildInvoiceView(fixtureBundle({ interState: true }));
    expect(view.interState).toBe(true);
    expect(view.placeOfSupply).toBe("Karnataka (29)");
    expect(view.recipient?.state).toBe("Karnataka (29)");
    expect(view.lines[0]).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 18000 });
    expect(view.totals).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 36000 });
    expect(view.taxSummary[0]).toMatchObject({ igstPaise: 36000, cgstPaise: 0 });
  });

  it("builds a bill of supply for a composition dealer: no tax columns, declaration printed", () => {
    const view = buildInvoiceView(fixtureBundle({ documentType: "bill_of_supply" }));
    expect(view.title).toBe("Bill of Supply");
    expect(view.showTax).toBe(false);
    expect(view.showGstFields).toBe(true);
    expect(view.declaration).toBe(COMPOSITION_DECLARATION);
    expect(view.seller.gstin).toBe("27AAPFU0939F1ZV");
    expect(view.taxSummary).toEqual([]);
    expect(view.lines.every((l) => l.gstRate === "" && l.cgstPaise === 0 && l.igstPaise === 0)).toBe(true);
    expect(view.lines[0].hsn).toBe("1006");
    expect(view.totals.taxPaise).toBe(0);
    expect(view.placeOfSupply).toBe("Maharashtra (27)");
  });

  it("builds a cash memo with no GSTIN and no GST fields anywhere", () => {
    const view = buildInvoiceView(
      fixtureBundle({
        documentType: "cash_memo",
        // Even if stale data carried a GSTIN, a cash memo must never print one.
        invoice: { seller_gstin: "27AAPFU0939F1ZV", customer_gstin: "29AAGCB7383J1Z4" },
      }),
    );
    expect(view.title).toBe("Cash Memo");
    expect(view.showGstFields).toBe(false);
    expect(view.showTax).toBe(false);
    expect(view.showHsn).toBe(false);
    expect(view.seller.gstin).toBeNull();
    expect(view.recipient?.gstin).toBeNull();
    expect(view.placeOfSupply).toBeNull();
    expect(view.reverseCharge).toBeNull();
    expect(view.declaration).toBeNull();
    expect(view.taxSummary).toEqual([]);
    expect(view.seller.state).toBe("Maharashtra");
    expect(view.lines.every((l) => l.hsn === "" && l.gstRate === "")).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/GSTIN|27AAPFU0939F1ZV|29AAGCB7383J1Z4/);
  });

  it("trims HSN codes to the business setting (4 or 6 digits)", () => {
    const four = buildInvoiceView(fixtureBundle({ business: { hsn_digits: 4 } }));
    const six = buildInvoiceView(fixtureBundle({ business: { hsn_digits: 6 } }));
    expect(four.lines[0].hsn).toBe("1006");
    expect(six.lines[0].hsn).toBe("100630");
    const short = buildInvoiceView(
      fixtureBundle({ business: { hsn_digits: 6 }, items: [fixtureItem(1, "intra", { hsn_code: "1006" })] }),
    );
    expect(short.lines[0].hsn).toBe("1006");
    expect(short.showHsn).toBe(true);
  });

  it("flags a cancelled bill and removes the payment request", () => {
    const view = buildInvoiceView(
      fixtureBundle({ invoice: { status: "cancelled", cancel_reason: "Wrong items", amount_due_paise: 5000 } }),
    );
    expect(view.cancelled).toBe(true);
    expect(view.cancelReason).toBe("Wrong items");
    expect(view.upi).toBeNull();
    expect(view.amountDuePaise).toBe(0);
  });

  it("encodes the exact payable amount in the UPI link", () => {
    const paid = buildInvoiceView(fixtureBundle());
    expect(paid.upi?.amountPaise).toBe(236000);
    expect(paid.upi?.due).toBe(false);
    expect(paid.upi?.uri).toContain("upi://pay?");
    expect(paid.upi?.uri).toContain("pa=sharma%40okaxis");
    expect(paid.upi?.uri).toContain("am=2360.00");
    expect(paid.upi?.uri).toContain("cu=INR");

    const credit = buildInvoiceView(fixtureBundle({ invoice: { amount_due_paise: 123450 } }));
    expect(credit.upi?.amountPaise).toBe(123450);
    expect(credit.upi?.due).toBe(true);
    expect(credit.upi?.uri).toContain("am=1234.50");
    expect(credit.amountDuePaise).toBe(123450);
    expect(credit.paidPaise).toBe(236000 - 123450);

    expect(buildInvoiceView(fixtureBundle({ business: { upi_id: null } })).upi).toBeNull();
  });

  it("hides empty recipient fields and the whole block for a walk-in sale", () => {
    const walkIn = buildInvoiceView(
      fixtureBundle({
        invoice: {
          customer_id: null,
          customer_name: null,
          customer_phone: "  ",
          customer_email: null,
          customer_address: null,
          customer_pincode: null,
          customer_state_code: null,
        },
      }),
    );
    expect(walkIn.recipient).toBeNull();

    const nameOnly = buildInvoiceView(
      fixtureBundle({
        invoice: { customer_phone: null, customer_email: "", customer_address: "", customer_pincode: null, customer_state_code: null },
      }),
    );
    expect(nameOnly.recipient).toEqual({
      name: "Anita Deshmukh",
      phone: null,
      email: null,
      addressLines: [],
      gstin: null,
      state: null,
    });
  });

  it("shows address and state for an unregistered recipient when present", () => {
    const view = buildInvoiceView(fixtureBundle());
    expect(view.recipient?.addressLines).toEqual(["Flat 4, Shanti Niwas", "Karve Nagar, Pune - 411052"]);
    expect(view.recipient?.state).toBe("Maharashtra (27)");
    expect(view.recipient?.gstin).toBeNull();
  });

  it("hides empty bank details, legal name duplicates and falls back to the business address", () => {
    const view = buildInvoiceView(
      fixtureBundle({
        business: { trade_name: null, bank_name: null, bank_account_name: " ", bank_account_number: null, ifsc: null, invoice_terms: null, invoice_footer: null },
        outlet: null,
      }),
    );
    expect(view.bank).toBeNull();
    expect(view.seller.name).toBe("Sharma Traders Private Limited");
    expect(view.seller.legalName).toBeNull();
    expect(view.seller.addressLines).toEqual(["12 MG Road", "Near City Mall", "Pune - 411001"]);
    expect(view.terms).toEqual([]);
    expect(view.footer).toBeNull();
  });

  it("orders lines by line number and sums payments without the credit part", () => {
    const view = buildInvoiceView(
      fixtureBundle({
        items: [fixtureItem(2, "intra"), fixtureItem(1, "intra", { discount_paise: 500 })],
        invoice: { amount_due_paise: 100000 },
        payments: [
          { id: "p1", mode: "upi", amount_paise: 136000, reference: "UTR123", is_collection: false, received_on: "2026-11-12" },
          { id: "p2", mode: "credit", amount_paise: 100000, reference: null, is_collection: false, received_on: "2026-11-12" },
        ],
      }),
    );
    expect(view.lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(view.showDiscount).toBe(true);
    expect(view.paidPaise).toBe(136000);
    expect(view.payments[0]).toMatchObject({ label: "UPI", reference: "UTR123", date: "12/11/2026" });
  });
});

describe("token and id shape checks", () => {
  it("accepts 64-char hex and 43-char base64url tokens only", () => {
    expect(isPublicTokenShape("a".repeat(64))).toBe(true);
    expect(isPublicTokenShape("Ab_-9".repeat(8) + "xyz")).toBe(true);
    expect(isPublicTokenShape("short")).toBe(false);
    expect(isPublicTokenShape("a".repeat(31))).toBe(false);
    expect(isPublicTokenShape("a".repeat(129))).toBe(false);
    expect(isPublicTokenShape("a".repeat(40) + "%27")).toBe(false);
    expect(isPublicTokenShape(null)).toBe(false);
  });
  it("recognises uuids", () => {
    expect(isUuid("44444444-4444-4444-8444-444444444444")).toBe(true);
    expect(isUuid("44444444")).toBe(false);
  });
});
