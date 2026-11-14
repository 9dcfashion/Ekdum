import { invoiceEmailText, type InvoiceEmailProps } from "@/emails/invoice";
import type { InvoiceBundle } from "@/lib/invoices/types";
import { buildInvoiceView } from "@/lib/invoices/view";
import { formatINR } from "@/lib/money";
import { invoicePdfFilename } from "@/lib/pdf/format";
import type { EmailMessage, EmailProvider, WhatsAppInvoiceMessage, WhatsAppProvider } from "@/lib/providers/types";

/** The columns of a claimed notification_jobs row that the worker uses. */
export interface OutboxJob {
  id: string;
  business_id: string;
  channel: "email" | "whatsapp";
  template: string;
  recipient: string;
  related_table: string | null;
  related_id: string | null;
}

export interface DeliveryOutcome {
  success: boolean;
  messageId?: string;
  error?: string;
  /** True when retrying cannot help, so the job goes straight to "failed". */
  permanent: boolean;
}

/** Everything with side effects is injected, so the decision logic can be tested with fakes. */
export interface DeliveryDeps {
  loadBundle(invoiceId: string): Promise<InvoiceBundle | null>;
  /** Live WhatsApp consent of the customer on the bill (false when there is no customer). */
  customerOptedIn(customerId: string | null, businessId: string): Promise<boolean>;
  renderPdf(bundle: InvoiceBundle): Promise<Buffer>;
  renderEmailHtml(props: InvoiceEmailProps): Promise<string>;
  email: EmailProvider;
  whatsapp: WhatsAppProvider;
  absoluteUrl(path: string): string;
}

export const FAILURE = {
  unknownJob: "This kind of message is not supported",
  notFound: "The bill for this message no longer exists",
  cancelled: "The bill was cancelled, so the receipt was not sent",
  linkRevoked: "The public link for this bill has been turned off",
  disabled: "Disabled in settings",
  notOptedIn: "Customer has not opted in",
  noRecipient: "No recipient to send to",
} as const;

const permanentFailure = (error: string): DeliveryOutcome => ({ success: false, error, permanent: true });

/** Reasons a job must not be sent at all. Null means "go ahead". */
export function blockingReason(job: OutboxJob, bundle: InvoiceBundle | null): string | null {
  if (job.template !== "invoice_receipt" || job.related_table !== "sales_invoices" || !job.related_id) {
    return FAILURE.unknownJob;
  }
  if (job.channel !== "email" && job.channel !== "whatsapp") return FAILURE.unknownJob;
  if (!bundle || bundle.invoice.business_id !== job.business_id) return FAILURE.notFound;
  if (bundle.invoice.status === "cancelled") return FAILURE.cancelled;
  // Both messages carry the public link (WhatsApp also needs it to fetch the PDF).
  if (bundle.invoice.public_token_revoked_at) return FAILURE.linkRevoked;
  const enabled =
    job.channel === "email" ? bundle.business.notify_email_enabled : bundle.business.notify_whatsapp_enabled;
  if (enabled === false) return FAILURE.disabled;
  if (job.recipient.trim().length === 0) return FAILURE.noRecipient;
  return null;
}

export function invoicePublicPaths(bundle: InvoiceBundle): { page: string; pdf: string } {
  const { id, public_token: token } = bundle.invoice;
  return { page: `/i/${token}`, pdf: `/api/invoices/${id}/pdf?token=${token}` };
}

export function buildEmailProps(bundle: InvoiceBundle, publicUrl: string): InvoiceEmailProps {
  const view = buildInvoiceView(bundle);
  return {
    businessName: view.seller.name,
    brandColor: view.brandColor,
    customerName: view.recipient?.name ?? null,
    documentTitle: view.title,
    invoiceNumber: view.number,
    invoiceDate: view.date,
    amount: formatINR(bundle.invoice.total_paise),
    publicUrl,
    businessPhone: view.seller.phone,
  };
}

export function buildEmailMessage(args: {
  to: string;
  props: InvoiceEmailProps;
  html: string;
  pdf: Buffer;
  replyTo: string | null;
}): EmailMessage {
  const { props } = args;
  return {
    to: args.to,
    subject: `Your bill ${props.invoiceNumber} from ${props.businessName}`,
    html: args.html,
    text: invoiceEmailText(props),
    attachments: [
      { filename: invoicePdfFilename(props.invoiceNumber), content: args.pdf, contentType: "application/pdf" },
    ],
    fromName: props.businessName,
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
  };
}

export function buildWhatsAppMessage(
  job: Pick<OutboxJob, "recipient">,
  bundle: InvoiceBundle,
  absoluteUrl: (path: string) => string,
): WhatsAppInvoiceMessage {
  const view = buildInvoiceView(bundle);
  const paths = invoicePublicPaths(bundle);
  return {
    to: job.recipient.trim(),
    customerName: view.recipient?.name ?? "Customer",
    businessName: view.seller.name,
    invoiceNumber: view.number,
    amount: formatINR(bundle.invoice.total_paise),
    pdfUrl: absoluteUrl(paths.pdf),
    pdfFilename: invoicePdfFilename(view.number),
    publicToken: bundle.invoice.public_token,
    publicUrl: absoluteUrl(paths.page),
  };
}

/** Keeps provider/runtime error text short and free of anything that looks like a token. */
export function safeErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return (
    text
      .replace(/[A-Za-z0-9_-]{32,}/g, "[hidden]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || "Unknown error"
  );
}

/**
 * Sends one claimed job and reports what happened. Never throws: a crash while
 * loading or rendering becomes a retryable failure, so the job is always completed.
 */
export async function deliverJob(job: OutboxJob, deps: DeliveryDeps): Promise<DeliveryOutcome> {
  try {
    const bundle = job.related_id ? await deps.loadBundle(job.related_id) : null;
    const blocked = blockingReason(job, bundle);
    if (blocked || !bundle) return permanentFailure(blocked ?? FAILURE.notFound);

    if (job.channel === "whatsapp") {
      // Consent is checked again at send time: the customer may have opted out since the job was queued.
      const optedIn = await deps.customerOptedIn(bundle.invoice.customer_id, bundle.invoice.business_id);
      if (!optedIn) return permanentFailure(FAILURE.notOptedIn);
      const message = buildWhatsAppMessage(job, bundle, deps.absoluteUrl);
      // Providers that cannot rely on WhatsApp fetching pdfUrl (e.g. a self-hosted gateway) get the file itself.
      if (deps.whatsapp.attachesPdf) message.pdf = await deps.renderPdf(bundle);
      const result = await deps.whatsapp.sendInvoice(message);
      return result.ok
        ? { success: true, messageId: result.messageId, permanent: false }
        : { success: false, error: safeErrorText(result.error), permanent: result.permanent === true };
    }

    const props = buildEmailProps(bundle, deps.absoluteUrl(invoicePublicPaths(bundle).page));
    const [html, pdf] = await Promise.all([deps.renderEmailHtml(props), deps.renderPdf(bundle)]);
    const result = await deps.email.send(
      buildEmailMessage({ to: job.recipient.trim(), props, html, pdf, replyTo: bundle.business.email?.trim() || null }),
    );
    return result.ok
      ? { success: true, messageId: result.messageId, permanent: false }
      : { success: false, error: safeErrorText(result.error), permanent: result.permanent === true };
  } catch (error) {
    return { success: false, error: safeErrorText(error), permanent: false };
  }
}

/** Runs `worker` over `items`, at most `limit` at a time. */
export async function runPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}
