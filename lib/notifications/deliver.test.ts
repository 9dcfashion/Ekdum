import { describe, expect, it } from "vitest";
import type { InvoiceBundle } from "@/lib/invoices/types";
import { FIXTURE_TOKEN, fixtureBundle } from "@/lib/invoices/fixtures";
import type { EmailMessage, SendResult, WhatsAppInvoiceMessage } from "@/lib/providers/types";
import {
  FAILURE,
  blockingReason,
  buildEmailProps,
  buildWhatsAppMessage,
  deliverJob,
  runPool,
  safeErrorText,
  type DeliveryDeps,
  type OutboxJob,
} from "./deliver";

const INVOICE_ID = "44444444-4444-4444-8444-444444444444";
const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: "job-1",
    business_id: BUSINESS_ID,
    channel: "email",
    template: "invoice_receipt",
    recipient: "anita@example.com",
    related_table: "sales_invoices",
    related_id: INVOICE_ID,
    ...overrides,
  };
}

function fakes(options: {
  bundle?: InvoiceBundle | null;
  optedIn?: boolean;
  emailResult?: SendResult;
  whatsappResult?: SendResult;
  renderPdf?: () => Promise<Buffer>;
} = {}) {
  const emails: EmailMessage[] = [];
  const whatsapps: WhatsAppInvoiceMessage[] = [];
  const deps: DeliveryDeps = {
    loadBundle: async () => (options.bundle === undefined ? fixtureBundle() : options.bundle),
    customerOptedIn: async () => options.optedIn ?? true,
    renderPdf: options.renderPdf ?? (async () => Buffer.from("%PDF-fake")),
    renderEmailHtml: async (props) => `<p>${props.invoiceNumber}</p>`,
    email: {
      name: "fake",
      send: async (message) => {
        emails.push(message);
        return options.emailResult ?? { ok: true, messageId: "email-1" };
      },
    },
    whatsapp: {
      name: "fake",
      sendInvoice: async (message) => {
        whatsapps.push(message);
        return options.whatsappResult ?? { ok: true, messageId: "wa-1" };
      },
    },
    absoluteUrl: (path) => `https://app.example${path}`,
  };
  return { deps, emails, whatsapps };
}

describe("deliverJob: email", () => {
  it("sends a branded email with the PDF attached and the public link", async () => {
    const { deps, emails } = fakes();
    const outcome = await deliverJob(job(), deps);
    expect(outcome).toEqual({ success: true, messageId: "email-1", permanent: false });
    expect(emails).toHaveLength(1);
    const message = emails[0];
    expect(message.to).toBe("anita@example.com");
    expect(message.subject).toBe("Your bill A/2627/00042 from Sharma Kirana");
    expect(message.fromName).toBe("Sharma Kirana");
    expect(message.replyTo).toBe("hello@sharmakirana.example");
    expect(message.html).toContain("A/2627/00042");
    expect(message.text).toContain(`https://app.example/i/${FIXTURE_TOKEN}`);
    expect(message.text).toContain("₹2,360.00");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0]).toMatchObject({ filename: "Invoice-A-2627-00042.pdf", contentType: "application/pdf" });
    expect(message.attachments?.[0].content.toString()).toBe("%PDF-fake");
  });

  it("omits reply-to when the business has no email", async () => {
    const { deps, emails } = fakes({ bundle: fixtureBundle({ business: { email: null } }) });
    await deliverJob(job(), deps);
    expect(emails[0].replyTo).toBeUndefined();
  });

  it("passes a provider failure through, keeping whether it is permanent", async () => {
    const temporary = await deliverJob(job(), fakes({ emailResult: { ok: false, error: "Rate limited" } }).deps);
    expect(temporary).toEqual({ success: false, error: "Rate limited", permanent: false });
    const permanent = await deliverJob(job(), fakes({ emailResult: { ok: false, error: "Bad address", permanent: true } }).deps);
    expect(permanent).toEqual({ success: false, error: "Bad address", permanent: true });
  });

  it("turns a rendering crash into a retryable failure instead of throwing", async () => {
    const { deps, emails } = fakes({
      renderPdf: async () => {
        throw new Error("render exploded");
      },
    });
    const outcome = await deliverJob(job(), deps);
    expect(outcome).toEqual({ success: false, error: "render exploded", permanent: false });
    expect(emails).toHaveLength(0);
  });
});

describe("deliverJob: WhatsApp", () => {
  const whatsappJob = () => job({ channel: "whatsapp", recipient: "+919812345678" });

  it("sends the template message with the public PDF and page links", async () => {
    const { deps, whatsapps } = fakes();
    const outcome = await deliverJob(whatsappJob(), deps);
    expect(outcome).toEqual({ success: true, messageId: "wa-1", permanent: false });
    expect(whatsapps[0]).toEqual({
      to: "+919812345678",
      customerName: "Anita Deshmukh",
      businessName: "Sharma Kirana",
      invoiceNumber: "A/2627/00042",
      amount: "₹2,360.00",
      pdfUrl: `https://app.example/api/invoices/${INVOICE_ID}/pdf?token=${FIXTURE_TOKEN}`,
      pdfFilename: "Invoice-A-2627-00042.pdf",
      publicToken: FIXTURE_TOKEN,
      publicUrl: `https://app.example/i/${FIXTURE_TOKEN}`,
    });
  });

  it("falls back to 'Customer' when the bill has no name", () => {
    const message = buildWhatsAppMessage(
      { recipient: "+919812345678" },
      fixtureBundle({ invoice: { customer_name: null } }),
      (p) => p,
    );
    expect(message.customerName).toBe("Customer");
  });

  it("does not render a PDF for providers that link to it", async () => {
    let renders = 0;
    const { deps, whatsapps } = fakes({
      renderPdf: async () => {
        renders += 1;
        return Buffer.from("%PDF-fake");
      },
    });
    await deliverJob(whatsappJob(), deps);
    expect(renders).toBe(0);
    expect(whatsapps[0].pdf).toBeUndefined();
  });

  it("attaches the rendered PDF for providers that upload it", async () => {
    const { deps, whatsapps } = fakes();
    deps.whatsapp = { ...deps.whatsapp, attachesPdf: true, sendInvoice: deps.whatsapp.sendInvoice };
    const outcome = await deliverJob(whatsappJob(), deps);
    expect(outcome).toEqual({ success: true, messageId: "wa-1", permanent: false });
    expect(whatsapps[0].pdf?.toString()).toBe("%PDF-fake");
    expect(whatsapps[0].pdfFilename).toBe("Invoice-A-2627-00042.pdf");
  });

  it("retries later when rendering the PDF for an uploading provider fails", async () => {
    const { deps, whatsapps } = fakes({
      renderPdf: async () => {
        throw new Error("render exploded");
      },
    });
    deps.whatsapp = { ...deps.whatsapp, attachesPdf: true, sendInvoice: deps.whatsapp.sendInvoice };
    const outcome = await deliverJob(whatsappJob(), deps);
    expect(outcome).toEqual({ success: false, error: "render exploded", permanent: false });
    expect(whatsapps).toHaveLength(0);
  });

  it("does not send when the customer has not opted in (checked at send time)", async () => {
    const { deps, whatsapps } = fakes({ optedIn: false });
    const outcome = await deliverJob(whatsappJob(), deps);
    expect(outcome).toEqual({ success: false, error: "Customer has not opted in", permanent: true });
    expect(whatsapps).toHaveLength(0);
  });
});

describe("deliverJob: bills that must not be sent", () => {
  const cases: Array<[string, InvoiceBundle | null, string]> = [
    ["missing bill", null, FAILURE.notFound],
    ["bill of another business", fixtureBundle({ invoice: { business_id: "00000000-0000-4000-8000-000000000000" } }), FAILURE.notFound],
    ["cancelled bill", fixtureBundle({ invoice: { status: "cancelled" } }), FAILURE.cancelled],
    ["revoked public link", fixtureBundle({ invoice: { public_token_revoked_at: "2026-11-12T08:00:00Z" } }), FAILURE.linkRevoked],
  ];
  for (const channel of ["email", "whatsapp"] as const) {
    for (const [name, bundle, reason] of cases) {
      it(`${channel}: ${name} is a permanent failure`, async () => {
        const { deps, emails, whatsapps } = fakes({ bundle });
        const outcome = await deliverJob(job({ channel }), deps);
        expect(outcome).toEqual({ success: false, error: reason, permanent: true });
        expect(emails.length + whatsapps.length).toBe(0);
      });
    }
  }

  it("respects the per-channel switches in settings", async () => {
    const emailOff = fakes({ bundle: fixtureBundle({ business: { notify_email_enabled: false } }) });
    expect(await deliverJob(job(), emailOff.deps)).toEqual({ success: false, error: "Disabled in settings", permanent: true });
    expect(await deliverJob(job({ channel: "whatsapp" }), emailOff.deps)).toMatchObject({ success: true });

    const whatsappOff = fakes({ bundle: fixtureBundle({ business: { notify_whatsapp_enabled: false } }) });
    expect(await deliverJob(job({ channel: "whatsapp" }), whatsappOff.deps)).toEqual({
      success: false,
      error: "Disabled in settings",
      permanent: true,
    });
    expect(whatsappOff.whatsapps).toHaveLength(0);
  });

  it("rejects jobs it does not understand", () => {
    expect(blockingReason(job({ template: "something_else" }), fixtureBundle())).toBe(FAILURE.unknownJob);
    expect(blockingReason(job({ related_table: "purchase_bills" }), fixtureBundle())).toBe(FAILURE.unknownJob);
    expect(blockingReason(job({ related_id: null }), null)).toBe(FAILURE.unknownJob);
    expect(blockingReason(job({ recipient: "  " }), fixtureBundle())).toBe(FAILURE.noRecipient);
    expect(blockingReason(job(), fixtureBundle())).toBeNull();
  });
});

describe("helpers", () => {
  it("builds the email fields from the bill", () => {
    expect(buildEmailProps(fixtureBundle({ documentType: "cash_memo" }), "https://x/i/t")).toMatchObject({
      businessName: "Sharma Kirana",
      documentTitle: "Cash Memo",
      invoiceDate: "12/11/2026",
      customerName: "Anita Deshmukh",
      publicUrl: "https://x/i/t",
    });
  });

  it("hides token-like strings in error text", () => {
    expect(safeErrorText(new Error(`fetch failed for /i/${FIXTURE_TOKEN}`))).toBe("fetch failed for /i/[hidden]");
    expect(safeErrorText(undefined)).toBe("Unknown error");
    expect(safeErrorText("x".repeat(10) + " y".repeat(400)).length).toBeLessThanOrEqual(300);
  });

  it("runs a bounded pool and keeps result order", async () => {
    let running = 0;
    let peak = 0;
    const results = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await runPool([], 3, async (n: number) => n)).toEqual([]);
  });
});
