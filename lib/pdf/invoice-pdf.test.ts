import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { fixtureBundle, fixtureItem, referenceBundle } from "@/lib/invoices/fixtures";
import { qrDataUrl } from "@/lib/invoices/qr";
import { buildInvoiceView } from "@/lib/invoices/view";
import { invoicePdfFilename, pdfMoney, pdfSafeDeep, pdfSigned, pdfText } from "./format";
import { InvoiceDocument, invoiceColumns } from "./invoice-document";
import { detectPdfImageFormat, renderInvoicePdf } from "./render";

/** Set PDF_TEST_OUTPUT_DIR to keep the rendered files for a visual check. */
function keep(name: string, pdf: Buffer) {
  const dir = process.env.PDF_TEST_OUTPUT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), pdf);
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
}

/**
 * The text drawn in the PDF, one string per text run. The built-in fonts write runs as
 * `[<hex> kerning <hex> ...] TJ` inside deflated content streams.
 */
function drawnText(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const runs: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const op of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const hex = [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]).join("");
      runs.push(Buffer.from(hex, "hex").toString("latin1"));
    }
  }
  return runs;
}

/** All drawn text as one string, runs joined with single spaces (a cell's text can be split into runs). */
const joinedText = (pdf: Buffer) => drawnText(pdf).join(" ").replace(/\s+/g, " ");

describe("renderInvoicePdf", () => {
  it("renders a 40-line tax invoice across several pages", async () => {
    const pdf = await renderInvoicePdf(fixtureBundle({ lineCount: 40, invoice: { amount_due_paise: 50000 } }));
    keep("tax-invoice-40.pdf", pdf);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it("renders an inter-state tax invoice with cess and awkward text", async () => {
    const pdf = await renderInvoicePdf(
      fixtureBundle({
        interState: true,
        items: [
          fixtureItem(1, "inter", { description: "Aerated drink ₹40 MRP “party pack” — 2L", cess_rate: 12, cess_paise: 12000, total_paise: 130000 }),
          fixtureItem(2, "inter", { description: "चावल basmati" }),
        ],
        invoice: { customer_gstin: "29AAGCB7383J1Z4", supply_type: "b2b", cess_paise: 12000, total_paise: 248000 },
      }),
    );
    keep("tax-invoice-igst.pdf", pdf);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it("renders a bill of supply", async () => {
    const pdf = await renderInvoicePdf(fixtureBundle({ documentType: "bill_of_supply" }));
    keep("bill-of-supply.pdf", pdf);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it("renders a cash memo", async () => {
    const pdf = await renderInvoicePdf(fixtureBundle({ documentType: "cash_memo", business: { upi_id: null } }));
    keep("cash-memo.pdf", pdf);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("renders a cancelled bill with the watermark", async () => {
    const pdf = await renderInvoicePdf(fixtureBundle({ invoice: { status: "cancelled", cancel_reason: "Billed twice" } }));
    keep("cancelled.pdf", pdf);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("the shopkeeper's boxed layout", () => {
  it("draws the reference bill on one page, cell for cell", async () => {
    const pdf = await renderInvoicePdf(referenceBundle());
    keep("reference-dc-fashion.pdf", pdf);
    expect(pageCount(pdf)).toBe(1);
    const text = joinedText(pdf);
    for (const expected of [
      "D C FASHION JEWELLERY",
      "Wholesale Dealer in: Stone Settled Exclusive Fancy Jewellery",
      "TAX INVOICE",
      "Original for Recipient",
      "Details of Buyer : Agrawal Gems",
      "GSTIN : 27ACAPV1182E1ZP",
      "Place of Supply: Maharashtra (27)",
      "Sr.No",
      "Description of Goods",
      "HSN Code",
      "50,000.00",
      "Total Taxable Amount",
      "90,000.00",
      "Add SGST",
      "Add IGST",
      "1.5%",
      "Total Amount",
      "92,700.00",
      "For D C FASHION JEWELLERY",
      "Proprietor",
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).toContain("A/C NO. 2512384715 / IFSC: KKBK0001347");
    expect(text).not.toMatch(/Page \d/);
    expect(text).not.toContain("GST %");
    expect(text).not.toContain("Disc.");
  });

  it("embeds the logo and the UPI QR in their boxes", async () => {
    const view = buildInvoiceView(referenceBundle({ business: { upi_id: "dcfashion@okhdfcbank" } }));
    const logo = { data: readFileSync(path.join(process.cwd(), "public/icons/icon-192.png")), format: "png" as const };
    const upiQr = await qrDataUrl(view.upi!.uri);
    const element = createElement(InvoiceDocument, { view: pdfSafeDeep(view), logo, upiQr });
    const pdf = await renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0]);
    keep("reference-logo-upi.pdf", pdf);
    expect(pageCount(pdf)).toBe(1);
    expect((pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The UPI ID sits under the QR, split before the "@".
    expect(joinedText(pdf)).toMatch(/dcfashion @ ?okhdfcbank/);
  });

  it("adds GST % and Disc. columns only when the bill needs them", async () => {
    const pdf = await renderInvoicePdf(
      fixtureBundle({
        items: [
          fixtureItem(1, "intra", { discount_paise: 11800, taxable_paise: 90000, cgst_paise: 8100, sgst_paise: 8100, total_paise: 106200 }),
          fixtureItem(2, "intra", {
            description: "Cooking oil 1L",
            gst_rate: 5,
            unit_code: "LTR",
            quantity: 3,
            unit_price_paise: 15750,
            taxable_paise: 45000,
            cgst_paise: 1125,
            sgst_paise: 1125,
            total_paise: 47250,
          }),
        ],
        invoice: { round_off_paise: 50, amount_due_paise: 50000, notes: "Deliver to the back gate" },
      }),
    );
    keep("tax-invoice-multi-rate.pdf", pdf);
    const text = joinedText(pdf);
    for (const expected of ["GST %", "Disc.", "2 PCS", "3 LTR", "Round Off +0.50", "Balance Due 500.00", "Note: Deliver"]) {
      expect(text, expected).toContain(expected);
    }
    expect(drawnText(pdf).filter((t) => t === "Add SGST")).toHaveLength(2);
    expect(text).not.toContain("Add IGST");
    expect(text).toContain("Authorised Signatory");
  });

  it("prints no GSTIN, HSN or tax rows on a cash memo", async () => {
    const pdf = await renderInvoicePdf(fixtureBundle({ documentType: "cash_memo", business: { upi_id: null } }));
    const text = joinedText(pdf);
    expect(text).toContain("CASH MEMO");
    expect(text).toContain("Bill No: A/2627/00042");
    expect(text).not.toMatch(/GSTIN|HSN|SGST|CGST|IGST|Place of Supply/);
  });

  it("repeats the item header and numbers the pages of a long bill", async () => {
    const pdf = await renderInvoicePdf(fixtureBundle({ lineCount: 40 }));
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThanOrEqual(2);
    const text = drawnText(pdf);
    expect(text.filter((t) => t === "Sr.No")).toHaveLength(pages);
    expect(joinedText(pdf)).toContain(`Page ${pages} of ${pages}`);
    // The totals travel with the last line.
    expect(text.lastIndexOf("Basmati Rice 5kg pack 40")).toBeGreaterThan(text.lastIndexOf("Sr.No"));
  });
});

describe("invoice columns", () => {
  const keys = (options: Parameters<typeof fixtureBundle>[0]) =>
    invoiceColumns(buildInvoiceView(fixtureBundle(options))).map((c) => c.key);

  it("prints the six columns of the shop's sheet on a tax invoice, intra- or inter-state", () => {
    expect(keys({})).toEqual(["sr", "description", "hsn", "qty", "rate", "amount"]);
    expect(keys({ interState: true })).toEqual(["sr", "description", "hsn", "qty", "rate", "amount"]);
  });
  it("keeps HSN on a bill of supply and drops it on a cash memo", () => {
    expect(keys({ documentType: "bill_of_supply" })).toEqual(["sr", "description", "hsn", "qty", "rate", "amount"]);
    expect(keys({ documentType: "cash_memo" })).toEqual(["sr", "description", "qty", "rate", "amount"]);
  });
});

describe("pdf text helpers", () => {
  it("formats paise with Indian grouping and no rupee sign", () => {
    expect(pdfMoney(0)).toBe("0.00");
    expect(pdfMoney(5)).toBe("0.05");
    expect(pdfMoney(99900)).toBe("999.00");
    expect(pdfMoney(123456)).toBe("1,234.56");
    expect(pdfMoney(12345650)).toBe("1,23,456.50");
    expect(pdfMoney(1234567890)).toBe("1,23,45,678.90");
    expect(pdfMoney(-123456)).toBe("-1,234.56");
    expect(pdfMoney(null)).toBe("0.00");
    expect(pdfSigned(40)).toBe("+0.40");
    expect(pdfSigned(-35)).toBe("-0.35");
  });

  it("never lets a character through that Helvetica cannot draw", () => {
    expect(pdfText("₹1,200 only")).toBe("Rs. 1,200 only");
    expect(pdfText("“Quote” – it’s…")).toBe('"Quote" - it\'s...');
    expect(pdfText("चावल rice")).toBe("???? rice");
    expect(pdfText("Café 2 × 3")).toBe("Café 2 × 3");
    expect(pdfText(null)).toBe("");
    const safe = pdfSafeDeep({ a: "₹5", b: ["•", { c: "ok", d: 5, e: null }] });
    expect(safe).toEqual({ a: "Rs. 5", b: ["·", { c: "ok", d: 5, e: null }] });
    expect(/^[\n\x20-\x7E\xA1-\xFF]*$/.test(JSON.stringify(pdfSafeDeep(buildInvoiceView(fixtureBundle()))))).toBe(true);
  });

  it("builds a safe file name", () => {
    expect(invoicePdfFilename("A/2627/00042")).toBe("Invoice-A-2627-00042.pdf");
    expect(invoicePdfFilename("C1/2627/00001")).toBe("Invoice-C1-2627-00001.pdf");
    expect(invoicePdfFilename("../x\"y")).toBe("Invoice-..-xy.pdf");
  });

  it("detects embeddable logo formats", () => {
    expect(detectPdfImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectPdfImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(detectPdfImageFormat(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57]))).toBe(null);
  });
});
