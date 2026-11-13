import "server-only";
import { Resend } from "resend";
import type { EmailMessage, EmailProvider, SendResult } from "./types";

/** Default in development: prints the email to the server console instead of sending it. */
export class ConsoleMockEmailProvider implements EmailProvider {
  readonly name = "mock";

  async send(message: EmailMessage): Promise<SendResult> {
    const attachments = (message.attachments ?? []).map((a) => `${a.filename} (${a.content.length} bytes)`);
    console.info(
      [
        "",
        "┌─ [mock email] ─────────────────────────────────────────",
        `│ To:      ${message.to}`,
        `│ Subject: ${message.subject}`,
        attachments.length ? `│ Attach:  ${attachments.join(", ")}` : null,
        "│",
        ...message.text.split("\n").map((line) => `│ ${line}`),
        "└────────────────────────────────────────────────────────",
        "",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    );
    return { ok: true, messageId: `mock-email-${Date.now()}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<SendResult> {
    // EMAIL_FROM may be "Name <addr@domain>" or just "addr@domain"; keep the verified address, swap the name.
    const address = /<([^>]+)>/.exec(this.from)?.[1] ?? this.from;
    const from = message.fromName ? `${message.fromName.replace(/[<>"]/g, "")} <${address}>` : this.from;
    try {
      const { data, error } = await this.client.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });
      if (error) {
        // 4xx validation errors will not succeed on retry; rate limits and 5xx might.
        const permanent = error.name === "validation_error" || error.name === "invalid_from_address";
        return { ok: false, error: error.message, permanent };
      }
      return { ok: true, messageId: data?.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Email send failed" };
    }
  }
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;
  const wanted = (process.env.EMAIL_PROVIDER ?? "mock").toLowerCase();
  if (wanted === "resend") {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (key && from) {
      cached = new ResendEmailProvider(key, from);
      return cached;
    }
    console.warn("[email] EMAIL_PROVIDER=resend but RESEND_API_KEY or EMAIL_FROM is missing. Using the mock provider.");
  }
  cached = new ConsoleMockEmailProvider();
  return cached;
}
