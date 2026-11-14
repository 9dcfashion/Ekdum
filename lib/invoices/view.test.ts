import { describe, expect, it } from "vitest";
import { COMPOSITION_DECLARATION } from "@/lib/gst/config";
import { fixtureBundle, fixtureItem, referenceBundle, type FixtureOptions } from "./fixtures";
import { buildInvoiceSheet, displayPhone, sheetColumns, splitWords, upiIdLines } from "./sheet";
import { isPublicTokenShape, isUuid } from "./token";
import { buildInvoiceView, preTaxPricing } from "./view";

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

const sheetOf = (options: FixtureOptions = {}) => buildInvoiceSheet(buildInvoiceView(fixtureBundle(options)));
const columnKeys = (options: FixtureOptions = {}) => sheetColumns(buildInvoiceView(fixtureBundle(options))).map((c) => c.key);

/** 18% line (intra or inter) priced tax-exclusive: taxable `taxable`, `qty` units. */
function taxLine(lineNo: number, rate: number, taxable: number, inter = false, overrides: Parameters<typeof fixtureItem>[2] = {}) {
  const tax = Math.round((taxable * rate) / 100);
  return fixtureItem(lineNo, inter ? "inter" : "intra", {
    price_includes_tax: false,
    unit_price_paise: taxable / 2,
    gst_rate: rate,
    taxable_paise: taxable,
    cgst_paise: inter ? 0 : Math.floor(tax / 2),
    sgst_paise: inter ? 0 : tax - Math.floor(tax / 2),
    igst_paise: inter ? tax : 0,
    total_paise: taxable + tax,
    ...overrides,
  });
}

describe("A4 sheet: the shopkeeper's boxed bill", () => {
  it("lays out the jeweller's reference bill like the original", () => {
    const sheet = buildInvoiceSheet(buildInvoiceView(referenceBundle()));
    expect(sheet.title).toBe("TAX INVOICE");
    expect(sheet.copyLabel).toBe("Original for Recipient");
    expect(sheet.shopName).toBe("D C FASHION JEWELLERY");
    expect(sheet.tagline).toBe("Wholesale Dealer in: Stone Settled Exclusive Fancy Jewellery");
    expect(sheet.addressRow).toBe(
      "2ND FLOOR ,SHOP NO 11, CRYSTAL PLAZA,ANAND ROAD, MALAD WEST, MUMBAI, Maharashtra (27), 400064",
    );
    expect(sheet.parties).toEqual([
      { left: { text: "Details of Buyer : Agrawal Gems" }, right: { text: "GSTIN : 27ACAPV1182E1ZP", accent: true } },
      { left: { text: "187/193, Kapadia building,shop no 117,Agiary 2nd Lane" }, right: { text: "Invoice No: A/2526/00163" } },
      { left: { text: "Zaveri Bazar, Mumbai-27" }, right: { text: "Invoice Date: 22/03/2026" } },
      { left: { text: "State: Maharashtra (27)" }, right: { text: "Place of Supply: Maharashtra (27)" } },
      { left: { text: "GSTIN: 27AADFA1321M1ZQ" }, right: { text: "Reverse charge(Y/N): No" } },
    ]);
    expect(sheet.columns.map((c) => c.label)).toEqual(["Sr.No", "Description of Goods", "HSN Code", "Qty", "Rate", "Amount"]);
    expect(sheet.columns.reduce((sum, c) => sum + c.width, 0)).toBeCloseTo(100, 6);
    expect(sheet.rows.map((r) => r.cells)).toEqual([
      ["1", "NECKLACE", "7117", "1,000", "50.00", "50,000.00"],
      ["2", "BRACELETS", "7117", "800", "50.00", "40,000.00"],
    ]);
    expect(sheet.subtotalLabel).toBe("Total Taxable Amount");
    expect(sheet.subtotal).toBe("90,000.00");
    // SGST and CGST at half the rate, then the unused IGST row with the full rate and no amount.
    expect(sheet.charges).toEqual([
      { label: "Add SGST", rate: "1.5%", amount: "1,350.00" },
      { label: "Add CGST", rate: "1.5%", amount: "1,350.00" },
      { label: "Add IGST", rate: "3%", amount: "" },
    ]);
    expect(sheet.bank).toEqual({
      lines: [
        "BANK DETAIL:- KOTAK MAHINDRA BANK, #1138 NEVILLA HOUSE , VASAI ROAD EAST, GHOKHIVARA-401208",
        "A/C NO. 2512384715 / IFSC: KKBK0001347",
      ],
      upiId: null,
    });
    expect(sheet.wordsLabel).toEqual(["Tax", "Amount"]);
    expect(sheet.words.join(" ")).toBe("RUPEES TWO THOUSAND SEVEN HUNDRED ONLY");
    expect(sheet.grandTotal).toBe("92,700.00");
    expect(sheet.totalInWords).toBe("RUPEES NINETY-TWO THOUSAND SEVEN HUNDRED ONLY");
    expect(sheet.balanceDue).toBeNull();
    expect(sheet.terms).toEqual([
      "1) This is to certify that we have valid Registration Under GST",
      "2) If Bill not paid within Due date,interest will be charged @",
      "3) Only Mumbai Courts will have Jurisdiction",
    ]);
    expect(sheet.signatoryFor).toBe("For D C FASHION JEWELLERY");
    expect(sheet.signatoryLabel).toBe("Proprietor");
    expect(sheet.footer).toBeNull();
    expect(sheet.cancelNote).toBeNull();
  });

  it("prints exactly six columns on a single-rate intra-state bill, with pre-tax rates that add up", () => {
    const view = buildInvoiceView(fixtureBundle());
    const sheet = buildInvoiceSheet(view);
    expect(sheet.columns.map((c) => c.key)).toEqual(["sr", "description", "hsn", "qty", "rate", "amount"]);
    // ₹590 incl. 18% GST → ₹500 before tax; Amount is the taxable value.
    expect(sheet.rows[0].cells).toEqual(["1", "Basmati Rice 5kg pack 1", "1006", "2", "500.00", "1,000.00"]);
    expect(view.lines.reduce((sum, l) => sum + l.taxablePaise, 0)).toBe(view.totals.taxablePaise);
    expect(sheet.charges).toEqual([
      { label: "Add SGST", rate: "9%", amount: "180.00" },
      { label: "Add CGST", rate: "9%", amount: "180.00" },
      { label: "Add IGST", rate: "18%", amount: "" },
    ]);
    expect(sheet.addressRow).toBe("12 MG Road, Pune, Maharashtra (27), 411001 \u00B7 Ph: 98765 43210 \u00B7 hello@sharmakirana.example");
    expect(sheet.bank?.upiId).toBe("sharma@okaxis");
  });

  it("adds a GST % column and one SGST/CGST pair per rate on a multi-rate bill", () => {
    const options = { items: [taxLine(1, 5, 100000), taxLine(2, 18, 200000), taxLine(3, 5, 50000)] };
    expect(columnKeys(options)).toEqual(["sr", "description", "hsn", "qty", "rate", "gst", "amount"]);
    const sheet = sheetOf(options);
    expect(sheet.columns.reduce((sum, c) => sum + c.width, 0)).toBeCloseTo(100, 6);
    expect(sheet.rows.map((r) => r.cells[5])).toEqual(["5%", "18%", "5%"]);
    expect(sheet.charges).toEqual([
      { label: "Add SGST", rate: "2.5%", amount: "37.50" },
      { label: "Add CGST", rate: "2.5%", amount: "37.50" },
      { label: "Add SGST", rate: "9%", amount: "180.00" },
      { label: "Add CGST", rate: "9%", amount: "180.00" },
    ]);
  });

  it("charges IGST on an inter-state bill", () => {
    expect(sheetOf({ interState: true }).charges).toEqual([
      { label: "Add SGST", rate: "9%", amount: "" },
      { label: "Add CGST", rate: "9%", amount: "" },
      { label: "Add IGST", rate: "18%", amount: "360.00" },
    ]);
    const multi = sheetOf({ interState: true, items: [taxLine(1, 12, 100000, true), taxLine(2, 0.25, 400000, true)] });
    expect(multi.charges).toEqual([
      { label: "Add IGST", rate: "0.25%", amount: "10.00" },
      { label: "Add IGST", rate: "12%", amount: "120.00" },
      // An empty row so the bank block has room for the UPI QR.
      null,
    ]);
    // Half of 0.25% keeps its third decimal.
    expect(sheetOf({ items: [taxLine(1, 0.25, 400000)] }).charges[0]).toEqual({ label: "Add SGST", rate: "0.125%", amount: "5.00" });
  });

  it("adds a Disc. column only when a line has a discount, with the rate and discount before tax", () => {
    const options = {
      items: [
        // ₹590 incl. 18% x 2 = ₹1,180, less ₹118 → ₹1,062 = ₹900 taxable + ₹162 GST.
        fixtureItem(1, "intra", { discount_paise: 11800, taxable_paise: 90000, cgst_paise: 8100, sgst_paise: 8100, total_paise: 106200 }),
        taxLine(2, 18, 90000, false, { quantity: 2, unit_price_paise: 50000, discount_paise: 10000 }),
        taxLine(3, 18, 100000),
      ],
    };
    expect(columnKeys(options)).toEqual(["sr", "description", "hsn", "qty", "rate", "discount", "amount"]);
    const rows = sheetOf(options).rows.map((r) => r.cells.slice(3));
    expect(rows).toEqual([
      ["2", "500.00", "100.00", "900.00"],
      ["2", "500.00", "100.00", "900.00"],
      ["2", "500.00", "", "1,000.00"],
    ]);
    expect(columnKeys({})).not.toContain("discount");
  });

  it("works out the pre-tax rate and discount", () => {
    const base = { quantity: 2, unit_price_paise: 59000, price_includes_tax: true, discount_paise: 0, taxable_paise: 100000, gst_rate: 18, cess_rate: 0 };
    expect(preTaxPricing(base)).toEqual({ ratePaise: 50000, discountPaise: 0 });
    expect(preTaxPricing({ ...base, discount_paise: 11800, taxable_paise: 90000 })).toEqual({ ratePaise: 50000, discountPaise: 10000 });
    // Tax-exclusive prices print as entered.
    expect(preTaxPricing({ ...base, price_includes_tax: false, unit_price_paise: 50000, discount_paise: 999 })).toEqual({
      ratePaise: 50000,
      discountPaise: 999,
    });
    // Nothing to back out at 0%.
    expect(preTaxPricing({ ...base, gst_rate: 0, taxable_paise: 118000 })).toEqual({ ratePaise: 59000, discountPaise: 0 });
    // Odd quantities round the rate to the paisa: 3 x 33.33 = 99.99 against a taxable value of 100.00.
    expect(preTaxPricing({ ...base, quantity: 3, unit_price_paise: 3933, taxable_paise: 10000 })).toEqual({ ratePaise: 3333, discountPaise: 0 });
  });

  it("shows units in the Qty column only when they differ or are not PCS/NOS", () => {
    expect(sheetOf().rows[0].cells[3]).toBe("2");
    const mixed = sheetOf({ items: [fixtureItem(1, "intra"), fixtureItem(2, "intra", { unit_code: "NOS" })] });
    expect(mixed.rows.map((r) => r.cells[3])).toEqual(["2 PCS", "2 NOS"]);
    const kilos = sheetOf({ items: [fixtureItem(1, "intra", { unit_code: "KGS", quantity: 1.5 })] });
    expect(kilos.rows[0].cells[3]).toBe("1.5 KGS");
  });

  it("prints a bill of supply with HSN and GSTIN but no tax rows, and the declaration as the last term", () => {
    const sheet = sheetOf({ documentType: "bill_of_supply" });
    expect(sheet.title).toBe("BILL OF SUPPLY");
    expect(sheet.columns.map((c) => c.key)).toEqual(["sr", "description", "hsn", "qty", "rate", "amount"]);
    expect(sheet.subtotalLabel).toBe("Total");
    // Only empty rows beside the bank details (QR height), no tax.
    expect(sheet.charges).toEqual([null, null, null]);
    expect(sheet.wordsLabel).toEqual(["Amount", "in words"]);
    expect(sheet.words).toEqual(["RUPEES TWO THOUSAND ONLY", ""]);
    expect(sheet.totalInWords).toBeNull();
    expect(sheet.parties[0].right).toEqual({ text: "GSTIN : 27AAPFU0939F1ZV", accent: true });
    expect(sheet.terms.at(-1)).toBe(`3) ${COMPOSITION_DECLARATION}`);
  });

  it("prints a cash memo with no GSTIN, HSN, place of supply or tax rows anywhere", () => {
    const sheet = sheetOf({
      documentType: "cash_memo",
      business: { upi_id: null, bank_name: null, bank_account_name: null, bank_account_number: null, ifsc: null },
      invoice: { seller_gstin: "27AAPFU0939F1ZV", customer_gstin: "29AAGCB7383J1Z4" },
    });
    expect(sheet.title).toBe("CASH MEMO");
    expect(sheet.columns.map((c) => c.key)).toEqual(["sr", "description", "qty", "rate", "amount"]);
    expect(sheet.columns.reduce((sum, c) => sum + c.width, 0)).toBeCloseTo(100, 6);
    expect(sheet.parties.map((p) => p.right?.text ?? null)).toEqual(["Bill No: A/2627/00042", "Bill Date: 12/11/2026", null, null]);
    expect(sheet.charges).toEqual([]);
    expect(sheet.bank).toBeNull();
    expect(sheet.addressRow).toContain("Pune, Maharashtra, 411001");
    expect(JSON.stringify(sheet)).not.toMatch(/GSTIN|HSN|Place of Supply|Reverse charge|SGST|CGST|IGST|27AAPFU0939F1ZV/);
  });

  it("prints the tagline and signature title when set, and sensible defaults when not", () => {
    const plain = buildInvoiceView(fixtureBundle());
    expect(plain.tagline).toBeNull();
    expect(plain.signatoryLabel).toBe("Authorised Signatory");
    expect(buildInvoiceSheet(plain).tagline).toBeNull();

    const set = buildInvoiceView(fixtureBundle({ business: { invoice_tagline: " Dealers in rice ", signatory_label: "Partner" } }));
    expect(set.tagline).toBe("Dealers in rice");
    expect(buildInvoiceSheet(set).signatoryLabel).toBe("Partner");
    expect(buildInvoiceView(fixtureBundle({ business: { signatory_label: "  " } })).signatoryLabel).toBe("Authorised Signatory");
  });

  it("names a walk-in buyer Cash Sale and shows the phone when there is no address", () => {
    const walkIn = sheetOf({
      invoice: { customer_id: null, customer_name: null, customer_phone: null, customer_email: null, customer_address: null, customer_pincode: null, customer_state_code: null },
    });
    expect(walkIn.parties.map((p) => p.left?.text ?? null)).toEqual(["Details of Buyer : Cash Sale", null, null, null, null]);
    const phoneOnly = sheetOf({ invoice: { customer_address: null, customer_pincode: null, customer_state_code: null } });
    expect(phoneOnly.parties[1].left?.text).toBe("Ph: 98123 45678");
  });

  it("adds cess, round off, balance due and the note, and numbers terms once", () => {
    const sheet = sheetOf({
      items: [fixtureItem(1, "intra", { cess_rate: 12, cess_paise: 12000, total_paise: 130000 })],
      invoice: { round_off_paise: 50, amount_due_paise: 50000, notes: "Deliver to the back gate" },
      business: { invoice_terms: "1) No returns\n2. Pay in 7 days\n(3) Subject to Pune jurisdiction" },
    });
    expect(sheet.charges.slice(-2)).toEqual([
      { label: "Add Cess", rate: "", amount: "120.00" },
      { label: "Round Off", rate: "", amount: "+0.50" },
    ]);
    expect(sheet.balanceDue).toBe("500.00");
    expect(sheet.note).toBe("Note: Deliver to the back gate");
    expect(sheet.terms).toEqual(["1) No returns", "2) Pay in 7 days", "3) Subject to Pune jurisdiction"]);
  });

  it("flags a cancelled bill", () => {
    const sheet = sheetOf({ invoice: { status: "cancelled", cancel_reason: "Billed twice", amount_due_paise: 5000 } });
    expect(sheet.cancelNote).toBe("This bill was cancelled. Reason: Billed twice");
    expect(sheet.balanceDue).toBeNull();
    expect(sheet.bank?.upiId).toBeNull();
  });

  it("splits words, phones and UPI IDs for the boxes they sit in", () => {
    expect(splitWords("RUPEES FIFTY ONLY")).toEqual(["RUPEES FIFTY ONLY", ""]);
    expect(splitWords("RUPEES TWO THOUSAND SEVEN HUNDRED ONLY")).toEqual(["RUPEES TWO THOUSAND", "SEVEN HUNDRED ONLY"]);
    expect(displayPhone("+919820011001")).toBe("98200 11001");
    expect(displayPhone("022 2345 6789")).toBe("022 2345 6789");
    expect(upiIdLines("shop@ybl")).toEqual(["shop@ybl"]);
    expect(upiIdLines("dcfashion@okhdfcbank")).toEqual(["dcfashion", "@okhdfcbank"]);
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
