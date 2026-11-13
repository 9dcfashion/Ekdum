import "server-only";
import { createElement } from "react";
import { render } from "@react-email/components";
import { InvoiceEmail } from "@/emails/invoice";
import { absoluteUrl } from "@/lib/env";
import { loadInvoiceBundle } from "@/lib/invoices/load";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { getEmailProvider, getWhatsAppProvider } from "@/lib/providers";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { deliverJob, runPool, safeErrorText, type DeliveryDeps, type DeliveryOutcome, type OutboxJob } from "./deliver";

export interface ProcessSummary {
  claimed: number;
  sent: number;
  failed: number;
}

const CONCURRENCY = 3;

function buildDeps(admin: AdminClient): DeliveryDeps {
  return {
    loadBundle: (invoiceId) => loadInvoiceBundle(admin, { id: invoiceId }),
    async customerOptedIn(customerId, businessId) {
      if (!customerId) return false;
      const { data, error } = await admin
        .from("customers")
        .select("whatsapp_opt_in")
        .eq("id", customerId)
        .eq("business_id", businessId)
        .maybeSingle<{ whatsapp_opt_in: boolean }>();
      if (error) throw new Error(`Could not check WhatsApp consent: ${error.message}`);
      return data?.whatsapp_opt_in === true;
    },
    renderPdf: renderInvoicePdf,
    renderEmailHtml: (props) => render(createElement(InvoiceEmail, props)),
    email: getEmailProvider(),
    whatsapp: getWhatsAppProvider(),
    absoluteUrl,
  };
}

/** Records the outcome. Returns false when even that failed (the job is then retried after the 10 minute lock). */
async function complete(admin: AdminClient, job: OutboxJob, outcome: DeliveryOutcome): Promise<boolean> {
  const { error } = await admin.rpc("complete_notification_job", {
    p_job_id: job.id,
    p_success: outcome.success,
    p_provider_message_id: outcome.success ? (outcome.messageId ?? null) : null,
    p_error: outcome.success ? null : (outcome.error ?? "Unknown error"),
    p_permanent: outcome.success ? false : outcome.permanent,
  });
  if (error) {
    console.error(`[notifications] job ${job.id} (${job.channel}): could not record the outcome: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Claims due jobs from the notification outbox and sends them.
 * Called right after a bill is posted (via `after()`), by the
 * /api/jobs/notifications route, and every minute by pg_cron for retries.
 *
 * Logs job id, channel and outcome only: never recipients, tokens or keys.
 */
export async function processDueNotifications(limit = 20): Promise<ProcessSummary> {
  const summary: ProcessSummary = { claimed: 0, sent: 0, failed: 0 };

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.warn("[notifications] worker not configured:", safeErrorText(error));
    return summary;
  }

  const { data, error } = await admin.rpc("claim_notification_jobs", {
    p_limit: Math.max(1, Math.min(Math.floor(limit) || 20, 100)),
  });
  if (error) {
    console.error("[notifications] could not claim jobs:", error.message);
    return summary;
  }
  const jobs = (data ?? []) as OutboxJob[];
  summary.claimed = jobs.length;
  if (jobs.length === 0) return summary;

  const deps = buildDeps(admin);
  const outcomes = await runPool(jobs, CONCURRENCY, async (job) => {
    // deliverJob never throws, so every claimed job reaches complete_notification_job.
    const outcome = await deliverJob(job, deps);
    await complete(admin, job, outcome);
    console.info(
      `[notifications] job ${job.id} (${job.channel}): ${
        outcome.success ? "sent" : outcome.permanent ? "failed, will not retry" : "failed, will retry"
      }`,
    );
    return outcome;
  });

  for (const outcome of outcomes) {
    if (outcome.success) summary.sent += 1;
    else summary.failed += 1;
  }
  return summary;
}
