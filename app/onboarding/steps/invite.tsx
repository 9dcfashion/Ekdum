"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, MailCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { emailRequired } from "@/lib/validation/common";
import { inviteStaffDuringOnboardingAction, skipStepAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, useGoToStep } from "./shared";

const schema = z.object({ email: emailRequired, full_name: z.string().trim().max(100), role_id: z.uuid("Select a role") });
type Values = z.input<typeof schema>;

export function InviteStep({ data }: { data: WizardData }) {
  const goTo = useGoToStep();
  const invite = useAction();
  const next = useAction();
  const [sent, setSent] = useState<Array<{ email: string; acceptUrl: string; emailed: boolean }>>([]);
  const cashier = data.roles.find((r) => r.system_key === "cashier");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", full_name: "", role_id: cashier?.id ?? data.roles[0]?.id ?? "" },
  });
  const { errors } = form.formState;

  const pendingEmails = [...new Set([...data.invites.map((i) => i.email), ...sent.map((s) => s.email)])];

  return (
    <div>
      <form
        noValidate
        className="grid items-start gap-4 sm:grid-cols-[1fr_1fr_10rem_auto]"
        onSubmit={form.handleSubmit((values) =>
          invite.run(() => inviteStaffDuringOnboardingAction(values), {
            success: (r) => (r.emailed ? `Invite sent to ${r.email}` : `Invite created for ${r.email}`),
            onSuccess: (r) => {
              setSent((s) => [...s, r]);
              form.reset({ email: "", full_name: "", role_id: values.role_id });
            },
          }),
        )}
      >
        <Field label="Name" htmlFor="full_name" error={errors.full_name?.message}>
          <Input id="full_name" {...form.register("full_name")} />
        </Field>
        <Field label="Email" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" {...form.register("email")} />
        </Field>
        <Field label="Role" htmlFor="role_id" error={errors.role_id?.message}>
          <NativeSelect id="role_id" {...form.register("role_id")}>
            {data.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <SubmitButton pending={invite.pending} variant="outline" className="sm:mt-[1.6rem]">
          Send invite
        </SubmitButton>
      </form>

      <p className="mt-3 text-xs text-muted-foreground">
        Cashiers can only bill and see their own sales. Managers run day-to-day operations. You can fine-tune roles and
        outlet access later under Staff.
      </p>

      {pendingEmails.length > 0 ? (
        <ul className="mt-5 grid gap-2">
          {pendingEmails.map((email) => {
            const fresh = sent.find((s) => s.email === email);
            return (
              <li key={email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-2">
                  <MailCheck className="size-4 text-emerald-600" aria-hidden /> {email}
                  <span className="text-xs text-muted-foreground">Invite pending</span>
                </span>
                {fresh ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigator.clipboard.writeText(fresh.acceptUrl).then(
                        () => toast.success("Invite link copied. You can share it on WhatsApp."),
                        () => toast.error("Could not copy the link"),
                      )
                    }
                  >
                    <Copy aria-hidden /> Copy invite link
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          next.run(() => skipStepAction(6), { onSuccess: () => goTo(7) });
        }}
      >
        <StepFooter step={6} pending={next.pending} submitLabel={pendingEmails.length ? "Continue" : "Skip for now"} />
      </form>
    </div>
  );
}
