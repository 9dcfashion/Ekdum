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

/** True for links a customer's phone can open (not localhost or a private network address). */
export function isPublicUrl(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0") return false;
  if (host === "[::1]" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  return !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** The text sent with the invoice PDF. The bill link is added only when customers can open it. */
export function evolutionCaption(m: WhatsAppInvoiceMessage): string {
  const lines = [
    `Hi ${m.customerName}, thank you for shopping at ${m.businessName}.`,
    `Your bill ${m.invoiceNumber} for ${m.amount} is attached.`,
  ];
  if (isPublicUrl(m.publicUrl)) lines.push("", `View bill: ${m.publicUrl}`);
  return lines.join("\n");
}

interface EvolutionErrorBody {
  response?: { message?: unknown };
  message?: unknown;
  error?: unknown;
}

/** Maps an Evolution API error response to a short message, and whether a retry could help. */
function describeEvolutionError(status: number, json: EvolutionErrorBody): { error: string; permanent: boolean } {
  const detail = json.response?.message ?? json.message ?? json.error;
  const items = Array.isArray(detail) ? detail : [detail];
  // Sending to a number without WhatsApp: 400 with [{ exists: false, number, jid }].
  if (items.some((d) => typeof d === "object" && d !== null && (d as { exists?: unknown }).exists === false)) {
    return { error: "This number is not on WhatsApp", permanent: true };
  }
  if (status === 401 || status === 403) {
    return { error: "Evolution API rejected the key (check EVOLUTION_API_KEY)", permanent: false };
  }
  if (status === 404) {
    return { error: "Evolution instance not found (check EVOLUTION_INSTANCE)", permanent: false };
  }
  if (status === 413) return { error: "The invoice PDF is too large to send on WhatsApp", permanent: true };
  const text = items
    .map((d) => (typeof d === "string" ? d : d === undefined ? "" : JSON.stringify(d)))
    .filter(Boolean)
    .join("; ");
  // Anything else (session disconnected, rate limit, server error) may pass on a later attempt.
  return { error: `Evolution API returned ${status}${text ? `: ${text}` : ""}`, permanent: false };
}

/**
 * Evolution API: a self-hosted WhatsApp gateway (github.com/evolution-foundation/evolution-api).
 * Sends from an ordinary WhatsApp number linked to an Evolution instance, so no Meta account or
 * approved template is needed. The invoice PDF is uploaded with the message (the gateway cannot
 * fetch localhost links), captioned with the receipt text. See docs/RUNBOOK.md §5.5.
 */
export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  readonly name = "evolution";
  readonly attachesPdf = true;

  constructor(
    private readonly baseUrl: string,
    private readonly instance: string,
    private readonly apiKey: string,
  ) {}

  async sendInvoice(m: WhatsAppInvoiceMessage): Promise<SendResult> {
    const number = m.to.replace(/\D/g, "");
    if (number.length < 10) return { ok: false, error: "Not a valid WhatsApp number", permanent: true };
    if (!m.pdf) return { ok: false, error: "The invoice PDF was not rendered" };

    const body = {
      number,
      mediatype: "document",
      mimetype: "application/pdf",
      fileName: m.pdfFilename,
      caption: evolutionCaption(m),
      media: m.pdf.toString("base64"),
    };

    try {
      const response = await fetch(`${this.baseUrl}/message/sendMedia/${encodeURIComponent(this.instance)}`, {
        method: "POST",
        headers: { apikey: this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const json = (await response.json().catch(() => ({}))) as EvolutionErrorBody & { key?: { id?: string } };
      if (!response.ok) return { ok: false, ...describeEvolutionError(response.status, json) };
      return { ok: true, messageId: json.key?.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "WhatsApp send failed" };
    }
  }
}

let cached: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;
  const wanted = (process.env.WHATSAPP_PROVIDER ?? "mock").trim().toLowerCase();
  if (wanted === "meta") {
    const id = process.env.META_WA_PHONE_NUMBER_ID;
    const token = process.env.META_WA_ACCESS_TOKEN;
    const template = process.env.META_WA_INVOICE_TEMPLATE_NAME;
    if (id && token && template) {
      cached = new MetaWhatsAppProvider(id, token, template, process.env.META_WA_TEMPLATE_LANGUAGE || "en");
      return cached;
    }
    console.warn("[whatsapp] WHATSAPP_PROVIDER=meta but META_WA_* variables are missing. Using the mock provider.");
  }
  if (wanted === "evolution") {
    const url = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
    const instance = process.env.EVOLUTION_INSTANCE?.trim();
    const key = process.env.EVOLUTION_API_KEY?.trim();
    if (url && instance && key) {
      cached = new EvolutionWhatsAppProvider(url, instance, key);
      return cached;
    }
    console.warn("[whatsapp] WHATSAPP_PROVIDER=evolution but EVOLUTION_* variables are missing. Using the mock provider.");
  }
  cached = new ConsoleMockWhatsAppProvider();
  return cached;
}
