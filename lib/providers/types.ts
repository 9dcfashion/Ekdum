/**
 * Messaging providers sit behind these interfaces so a BSP (Gupshup, Interakt,
 * AiSensy …) or another email service can be swapped in without touching callers.
 */

export interface SendResult {
  ok: boolean;
  /** Provider's id for the message, shown on the invoice page. */
  messageId?: string;
  error?: string;
  /** True when retrying cannot help (bad address, template rejected, opted out). */
  permanent?: boolean;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  /** Display name for the From header, e.g. the shop's name. The address always comes from EMAIL_FROM. */
  fromName?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

/** An invoice receipt sent with an approved WhatsApp utility template. */
export interface WhatsAppInvoiceMessage {
  /** E.164, e.g. +919876543210. */
  to: string;
  customerName: string;
  businessName: string;
  invoiceNumber: string;
  /** Already formatted, e.g. "₹1,234.00". */
  amount: string;
  /** Publicly reachable PDF URL (the document header). */
  pdfUrl: string;
  pdfFilename: string;
  /** The token part of /i/{token}, used as the URL button's dynamic suffix. */
  publicToken: string;
  /** Full public link, used by providers that take a whole URL. */
  publicUrl: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendInvoice(message: WhatsAppInvoiceMessage): Promise<SendResult>;
}
