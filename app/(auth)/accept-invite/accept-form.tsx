"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { acceptInviteSchema, type AcceptInviteInput } from "@/lib/validation/auth";
import { acceptInviteExistingUserAction, acceptInviteNewUserAction } from "../actions";

export function AcceptInviteForm({ token, defaultName }: { token: string; defaultName: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const form = useForm<AcceptInviteInput>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { token, full_name: defaultName, password: "" },
  });
  const errors = form.formState.errors;

  return (
    <form
      className="mt-6 grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => acceptInviteNewUserAction(values), {
          success: "Welcome aboard!",
          onSuccess: () => {
            router.replace("/app");
            router.refresh();
          },
        }),
      )}
    >
      <Field label="Your name" htmlFor="full_name" error={errors.full_name?.message}>
        <Input id="full_name" autoComplete="name" autoFocus {...form.register("full_name")} />
      </Field>
      <Field label="Create a password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number.">
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <SubmitButton pending={pending} size="lg" pendingText="Setting up…">
        Accept invite
      </SubmitButton>
    </form>
  );
}

export function AcceptExistingButton({ token }: { token: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <SubmitButton
      type="button"
      size="lg"
      className="mt-6 w-full"
      pending={pending}
      onClick={() =>
        run(() => acceptInviteExistingUserAction(token), {
          success: "You have joined the business",
          onSuccess: () => {
            router.replace("/app");
            router.refresh();
          },
        })
      }
    >
      Accept invite
    </SubmitButton>
  );
}
