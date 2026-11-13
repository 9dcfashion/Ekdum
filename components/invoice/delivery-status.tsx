import { Mail, MessageCircle, Send } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/dates";
import { isStuckJob, maskPhone, maskRecipient } from "@/lib/notifications/mask";
import { getEmailProvider, getWhatsAppProvider } from "@/lib/providers";
import { ResendButton, SendEmailForm, SendWhatsAppButton } from "./delivery-actions";

interface JobRow {
  id: string;
  channel: "email" | "whatsapp";
  recipient: string;
  status: "queued" | "sending" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  status: "posted" | "cancelled";
  customer_id: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  public_token_revoked_at: string | null;
}

const CHANNEL_LABEL = { email: "Email", whatsapp: "WhatsApp" } as const;

/** Marks jobs whose worker never reported back. Kept out of the component so rendering stays pure. */
function withStuckFlag(jobs: JobRow[]): Array<JobRow & { stuck: boolean }> {
  const now = Date.now();
  return jobs.map((job) => ({ ...job, stuck: isStuckJob(job, now) }));
}

function providerName(get: () => { name: string }): string | null {
  try {
    return get().name;
  } catch {
    return null;
  }
}

/**
 * Receipt delivery (email / WhatsApp) for one bill: what was sent, what failed
 * and why, with resend and "send now". Everything is read with the signed-in
 * user's session, so RLS decides what is visible.
 */
export async function DeliveryStatus(props: { invoiceId: string }) {
  const ctx = await requireContext();
  if (!ctx.can(["sales.view_all", "sales.view_own"])) return null;

  const { data: invoice } = await ctx.supabase
    .from("sales_invoices")
    .select("id, status, customer_id, customer_email, customer_phone, public_token_revoked_at")
    .eq("id", props.invoiceId)
    .eq("business_id", ctx.business.id)
    .maybeSingle<InvoiceRow>();
  if (!invoice) return null;

  const [jobsResult, customerResult] = await Promise.all([
    ctx.supabase
      .from("notification_jobs")
      .select("id, channel, recipient, status, attempts, last_error, locked_at, next_attempt_at, sent_at, created_at")
      .eq("business_id", ctx.business.id)
      .eq("related_table", "sales_invoices")
      .eq("related_id", invoice.id)
      .order("created_at", { ascending: false })
      .limit(25)
      .returns<JobRow[]>(),
    invoice.customer_id && ctx.can("customers.view")
      ? ctx.supabase
          .from("customers")
          .select("whatsapp_opt_in")
          .eq("id", invoice.customer_id)
          .eq("business_id", ctx.business.id)
          .maybeSingle<{ whatsapp_opt_in: boolean }>()
      : Promise.resolve({ data: null }),
  ]);
  const jobs = withStuckFlag(jobsResult.data ?? []);
  // Null when this user cannot read customers: the server still checks consent before sending.
  const optedIn = customerResult.data ? customerResult.data.whatsapp_opt_in : null;

  const cancelled = invoice.status === "cancelled";
  const linkOff = !!invoice.public_token_revoked_at;
  const canResend = ctx.can(["sales.view_all", "sales.create"]);

  const blocked = cancelled
    ? "This bill is cancelled, so it cannot be sent."
    : linkOff
      ? "The public link for this bill is turned off, so it cannot be sent."
      : null;
  const emailDisabled =
    blocked ?? (ctx.business.notify_email_enabled ? null : "Email receipts are turned off in Settings.");
  const whatsappDisabled =
    blocked ??
    (!ctx.business.notify_whatsapp_enabled
      ? "WhatsApp receipts are turned off in Settings."
      : !invoice.customer_phone
        ? "This bill has no customer phone number."
        : !invoice.customer_id || optedIn === false
          ? "The customer has not agreed to get WhatsApp messages. Turn it on in their customer record first."
          : null);

  const mockChannels = [
    providerName(getEmailProvider) === "mock" ? "emails" : null,
    providerName(getWhatsAppProvider) === "mock" ? "WhatsApp messages" : null,
  ].filter((c): c is string => c !== null);

  return (
    <section className="rounded-xl border bg-card" aria-labelledby="delivery-status-title">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Send className="size-4 text-muted-foreground" aria-hidden />
        <h2 id="delivery-status-title" className="text-sm font-semibold">
          Receipt delivery
        </h2>
      </div>

      {mockChannels.length > 0 ? (
        <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Test mode: {mockChannels.join(" and ")} are printed in the server log, not sent.
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          This bill has not been sent to the customer yet. Send it below.
        </p>
      ) : (
        <ul className="divide-y">
          {jobs.map((job) => {
            const stuck = job.stuck;
            const Icon = job.channel === "email" ? Mail : MessageCircle;
            const when = job.status === "sent" && job.sent_at ? job.sent_at : job.created_at;
            return (
              <li key={job.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">{CHANNEL_LABEL[job.channel]}</span>
                    <span className="tabular truncate text-sm text-muted-foreground">
                      {maskRecipient(job.channel, job.recipient)}
                    </span>
                    {stuck ? <StatusBadge label="Stuck" tone="amber" /> : <StatusBadge status={job.status} />}
                  </div>
                  <p className="tabular mt-0.5 text-xs text-muted-foreground">
                    {job.status === "sent" ? "Sent" : "Added"} {formatDateTime(when)}
                    {job.attempts > 0 ? ` · ${job.attempts} ${job.attempts === 1 ? "attempt" : "attempts"}` : ""}
                    {job.status === "queued" && job.attempts > 0 ? ` · next try ${formatDateTime(job.next_attempt_at)}` : ""}
                  </p>
                  {(job.status === "failed" || (job.status === "queued" && job.attempts > 0)) && job.last_error ? (
                    <p className="mt-1 text-xs break-words text-destructive">{job.last_error}</p>
                  ) : null}
                </div>
                {canResend && !blocked && (job.status === "failed" || stuck) ? (
                  <ResendButton
                    jobId={job.id}
                    invoiceId={invoice.id}
                    label={`Resend ${CHANNEL_LABEL[job.channel]} receipt`}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-4 border-t px-4 py-4 sm:grid-cols-2">
        <SendEmailForm invoiceId={invoice.id} defaultEmail={invoice.customer_email ?? ""} disabledReason={emailDisabled} />
        <SendWhatsAppButton
          invoiceId={invoice.id}
          maskedPhone={invoice.customer_phone ? maskPhone(invoice.customer_phone) : null}
          disabledReason={whatsappDisabled}
        />
      </div>
    </section>
  );
}
