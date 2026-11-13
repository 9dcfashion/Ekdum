"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runAction, unwrap, type ActionResult } from "@/lib/actions";
import { processDueNotifications } from "./process";
import { retryReceiptSchema, sendReceiptSchema } from "./schema";

/** Send the queued message right after the response, without making the user wait for it. */
function sendSoon() {
  after(async () => {
    try {
      await processDueNotifications();
    } catch (error) {
      console.error("[notifications] run after action failed:", error instanceof Error ? error.message : "unknown error");
    }
  });
}

/**
 * "Send by email" / "Send on WhatsApp" on the bill page.
 * The database function re-checks access to the bill, and for WhatsApp only
 * ever uses the customer's own number and their recorded opt-in.
 */
export async function sendInvoiceReceiptAction(input: unknown): Promise<ActionResult<{ jobId: string | null }>> {
  return runAction(sendReceiptSchema, input, { perm: ["sales.view_all", "sales.view_own"] }, async (data, ctx) => {
    const jobId = unwrap(
      await ctx.supabase.rpc("send_invoice_notification", {
        p_invoice_id: data.invoiceId,
        p_channel: data.channel,
        p_recipient: data.channel === "email" ? data.email : null,
      }),
    ) as string | null;
    sendSoon();
    revalidatePath(`/app/sales/${data.invoiceId}`);
    return { jobId };
  });
}

/** "Resend" on a failed or stuck message. */
export async function retryInvoiceReceiptAction(input: unknown): Promise<ActionResult<{ jobId: string }>> {
  return runAction(retryReceiptSchema, input, { perm: ["sales.view_all", "sales.create"] }, async (data, ctx) => {
    unwrap(await ctx.supabase.rpc("retry_notification_job", { p_job_id: data.jobId }));
    sendSoon();
    revalidatePath(`/app/sales/${data.invoiceId}`);
    return { jobId: data.jobId };
  });
}
