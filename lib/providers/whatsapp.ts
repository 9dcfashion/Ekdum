import "server-only";
import type { SendResult, WhatsAppInvoiceMessage, WhatsAppProvider } from "./types";

/** Default in development: prints the WhatsApp message to the server console. */
export class ConsoleMockWhatsAppProvider implements WhatsAppProvider {
  readonly name = "mock";

  async sendInvoice(m: WhatsAppInvoiceMessage): Promise<SendResult> {
    console.info(
      [
        "",
        "┌─ [mock whatsapp] ──────────────────────────────────────",
        `│ To:       ${m.to}`,
        `│ Document: ${m.pdfFilename} → ${m.pdfUrl}`,
        `│ Body:     Hi ${m.customerName}, thank you for shopping at ${m.businessName}.`,
        `│           Your bill ${m.invoiceNumber} for ${m.amount} is attached.`,
        `│ Button:   View bill → ${m.publicUrl}`,
        "└────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { ok: true, messageId: `mock-wa-${Date.now()}` };
  }
}

// Graph API version. Meta retires versions on a schedule; override with META_GRAPH_VERSION when needed.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";

/**
 * Meta WhatsApp Cloud API. Sends an approved UTILITY template with:
 *   header  → document (the invoice PDF)
 *   body    → {{1}} customer name, {{2}} business name, {{3}} invoice number, {{4}} amount
 *   button  → URL button whose dynamic suffix is the public invoice token
 * The template must be created and approved in WhatsApp Manager first; see docs/RUNBOOK.md.
 */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = "meta";

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly templateName: string,
    private readonly language: string,
  ) {}

  async sendInvoice(m: WhatsAppInvoiceMessage): Promise<SendResult> {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: m.to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: this.templateName,
        language: { code: this.language },
        components: [
          {
            type: "header",
            parameters: [{ type: "document", document: { link: m.pdfUrl, filename: m.pdfFilename } }],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: m.customerName },
              { type: "text", text: m.businessName },
              { type: "text", text: m.invoiceNumber },
              { type: "text", text: m.amount },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: m.publicToken }],
          },
        ],
      },
    };

    try {
      const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number };
      };
      if (!response.ok || json.error) {
        const code = json.error?.code;
        // Never log the access token; the Graph error message does not contain it.
        const message = json.error?.message ?? `WhatsApp API returned ${response.status}`;
        // 131026 undeliverable, 131047 re-engagement, 132xxx template problems, 100 bad parameter, 131056 pair rate limit (retryable).
        const permanent = code !== undefined && (code === 100 || code === 131026 || (code >= 132000 && code < 133000));
        return { ok: false, error: `${message}${code ? ` (code ${code})` : ""}`, permanent };
      }
      return { ok: true, messageId: json.messages?.[0]?.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "WhatsApp send failed" };
    }
  }
}

let cached: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;
  if ((process.env.WHATSAPP_PROVIDER ?? "mock").toLowerCase() === "meta") {
    const id = process.env.META_WA_PHONE_NUMBER_ID;
    const token = process.env.META_WA_ACCESS_TOKEN;
    const template = process.env.META_WA_INVOICE_TEMPLATE_NAME;
    if (id && token && template) {
      cached = new MetaWhatsAppProvider(id, token, template, process.env.META_WA_TEMPLATE_LANGUAGE || "en");
      return cached;
    }
    console.warn("[whatsapp] WHATSAPP_PROVIDER=meta but META_WA_* variables are missing. Using the mock provider.");
  }
  cached = new ConsoleMockWhatsAppProvider();
  return cached;
}
