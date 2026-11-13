import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureBundle, fixtureItem } from "@/lib/invoices/fixtures";
import { buildInvoiceView } from "@/lib/invoices/view";
import { invoicePdfFilename, pdfMoney, pdfSafeDeep, pdfSigned, pdfText } from "./format";
import { invoiceColumns } from "./invoice-document";
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

describe("invoice columns", () => {
  const keys = (options: Parameters<typeof fixtureBundle>[0]) =>
    invoiceColumns(buildInvoiceView(fixtureBundle(options))).map((c) => c.key);

  it("prints CGST and SGST for an intra-state tax invoice", () => {
    expect(keys({})).toEqual(["no", "description", "hsn", "qty", "unit", "rate", "discount", "taxable", "gst", "cgst", "sgst", "total"]);
  });
  it("prints IGST for an inter-state tax invoice", () => {
    expect(keys({ interState: true })).toEqual(["no", "description", "hsn", "qty", "unit", "rate", "discount", "taxable", "gst", "igst", "total"]);
  });
  it("prints no tax columns on a bill of supply and no HSN on a cash memo", () => {
    expect(keys({ documentType: "bill_of_supply" })).toEqual(["no", "description", "hsn", "qty", "unit", "rate", "discount", "total"]);
    expect(keys({ documentType: "cash_memo" })).toEqual(["no", "description", "qty", "unit", "rate", "discount", "total"]);
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
