import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { NotificationsForm, type ChannelInfo } from "@/components/settings/notifications-form";
import { InfoBox, SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";
import { addDays, istDateString } from "@/lib/dates";
import { getEmailProvider, getWhatsAppProvider } from "@/lib/providers";

export const metadata = { title: "Notifications" };

const PROVIDER_NAMES: Record<string, string> = {
  mock: "Test mode (mock)",
  resend: "Resend",
  meta: "Meta WhatsApp Cloud API",
};

/**
 * Describes the provider that is really in use. Only names are read from the
 * environment here; keys and secrets are never sent to the page.
 */
function channelInfo(activeName: string, wanted: string | undefined, envName: string): ChannelInfo {
  const testMode = activeName === "mock";
  const asked = (wanted ?? "mock").toLowerCase();
  let note: string | undefined;
  if (testMode && asked !== "mock") {
    note = `${envName} is set to “${asked}”, but its keys are missing or it is not a known provider, so test mode is used.`;
  } else if (testMode) {
    note = "Nothing is really sent. Messages are only written to the server log.";
  }
  return { provider: PROVIDER_NAMES[activeName] ?? activeName, testMode, note };
}

export default async function NotificationsPage() {
  const ctx = await requirePage("settings.manage");
  const b = ctx.business;

  const email = channelInfo(getEmailProvider().name, process.env.EMAIL_PROVIDER, "EMAIL_PROVIDER");
  const whatsapp = channelInfo(getWhatsAppProvider().name, process.env.WHATSAPP_PROVIDER, "WHATSAPP_PROVIDER");
  // A yes/no only. The value itself never leaves the server.
  const jobsSecretSet = !!process.env.JOBS_SECRET;

  // RLS shows delivery jobs only to people who can see all sales.
  const canSeeJobs = ctx.can("sales.view_all");
  let failedCount = 0;
  if (canSeeJobs) {
    const since = `${addDays(istDateString(), -30)}T00:00:00+05:30`;
    const { count } = await ctx.supabase
      .from("notification_jobs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", b.id)
      .eq("status", "failed")
      .gte("created_at", since);
    failedCount = count ?? 0;
  }

  return (
    <SettingsSection title="Notifications" description="Receipts sent to customers after a sale.">
      <NotificationsForm
        key={`${b.notify_email_enabled}:${b.notify_whatsapp_enabled}`}
        initial={{ notify_email_enabled: b.notify_email_enabled, notify_whatsapp_enabled: b.notify_whatsapp_enabled }}
        email={email}
        whatsapp={whatsapp}
      />

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <InfoBox title="Background sending">
          <p className="flex items-start gap-1.5">
            {jobsSecretSet ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            )}
            <span>
              {jobsSecretSet
                ? "The retry job is set up (JOBS_SECRET is set). Receipts that fail are tried again automatically."
                : "JOBS_SECRET is not set, so the scheduled retry job cannot run. Receipts are still sent right after each sale, but failed ones are not retried on their own."}
            </span>
          </p>
          <p className="mt-2">Providers and keys are set in the server environment by whoever hosts EkDum for you, not on this page.</p>
        </InfoBox>
        <InfoBox title="Failed receipts">
          {canSeeJobs ? (
            <>
              <p>
                <span className="tabular text-base font-semibold text-foreground">{failedCount}</span>{" "}
                {failedCount === 1 ? "receipt" : "receipts"} could not be delivered in the last 30 days.
              </p>
              <p className="mt-2">
                Open the bill under{" "}
                <Link href="/app/sales" className="text-primary underline-offset-4 hover:underline">
                  Sales
                </Link>{" "}
                to see why and send it again.
              </p>
            </>
          ) : (
            <p>
              Your role cannot see delivery results. Someone who can view all sales will find them on each bill under Sales.
            </p>
          )}
        </InfoBox>
      </div>
    </SettingsSection>
  );
}
