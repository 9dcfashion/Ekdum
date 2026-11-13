"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/shared/submit-button";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/lib/use-action";
import { saveNotificationPrefsAction } from "@/app/app/(shell)/settings/actions";
import { FormFooter } from "./section";

export interface ChannelInfo {
  /** Human name of the provider in use, e.g. "Resend" or "Test mode (mock)". */
  provider: string;
  testMode: boolean;
  note?: string;
}

export function NotificationsForm({
  initial,
  email,
  whatsapp,
}: {
  initial: { notify_email_enabled: boolean; notify_whatsapp_enabled: boolean };
  email: ChannelInfo;
  whatsapp: ChannelInfo;
}) {
  const { run, pending } = useAction();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = values.notify_email_enabled !== saved.notify_email_enabled || values.notify_whatsapp_enabled !== saved.notify_whatsapp_enabled;

  const channels = [
    {
      key: "notify_email_enabled" as const,
      title: "Email receipts",
      description: "Email the bill as a PDF when the customer has an email address.",
      info: email,
    },
    {
      key: "notify_whatsapp_enabled" as const,
      title: "WhatsApp receipts",
      description: "Send the bill on WhatsApp to customers who have agreed to receive messages.",
      info: whatsapp,
    },
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveNotificationPrefsAction(values), { success: "Notification settings saved", onSuccess: () => setSaved(values) });
      }}
    >
      <ul className="grid gap-3">
        {channels.map((c) => (
          <li key={c.key} className="flex items-start justify-between gap-4 rounded-xl border p-3.5">
            <div className="min-w-0">
              <label htmlFor={c.key} className="text-sm font-medium">
                {c.title}
              </label>
              <p className="text-sm text-muted-foreground">{c.description}</p>
              <p className="mt-1.5 text-xs">
                <span className="text-muted-foreground">Sent through: </span>
                <span className={c.info.testMode ? "font-medium text-amber-700" : "font-medium"}>{c.info.provider}</span>
              </p>
              {c.info.note ? <p className="mt-0.5 text-xs text-muted-foreground">{c.info.note}</p> : null}
            </div>
            <Switch
              id={c.key}
              className="mt-1"
              checked={values[c.key]}
              onCheckedChange={(on) => setValues((v) => ({ ...v, [c.key]: on }))}
            />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Switching a channel off stops new receipts on it. You can still print every bill and share its link yourself.
      </p>
      <FormFooter>
        <SubmitButton pending={pending} size="lg" disabled={pending || !dirty}>
          Save notification settings
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
