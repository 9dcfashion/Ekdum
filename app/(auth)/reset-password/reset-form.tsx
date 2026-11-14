"use client";

import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation/auth";
import { resetPasswordAction } from "../actions";

export function ResetPasswordForm() {
  const router = useRouter();
  const { run, pending } = useAction();
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const errors = form.formState.errors;

  return (
    <form
      className="mt-6 grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => resetPasswordAction(values), {
          success: "Password updated",
          onSuccess: () => {
            router.replace("/app");
            router.refresh();
          },
        }),
      )}
    >
      <Field label="New password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters, with a letter and a number.">
        <Input id="password" type="password" autoComplete="new-password" autoFocus {...form.register("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <SubmitButton pending={pending} size="lg">
        Update password
      </SubmitButton>
    </form>
  );
}
