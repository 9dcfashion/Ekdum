"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { forgotPasswordAction } from "../actions";

export function ForgotPasswordForm() {
  const { run, pending } = useAction();
  const [sent, setSent] = useState(false);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  if (sent) {
    return (
      <p className="mt-6 rounded-xl border bg-muted/40 p-4 text-sm">
        If an account exists for that email, a reset link is on its way. The link works for one hour.
      </p>
    );
  }

  return (
    <form
      className="mt-6 grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) => run(() => forgotPasswordAction(values), { onSuccess: () => setSent(true) }))}
    >
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus {...form.register("email")} />
      </Field>
      <SubmitButton pending={pending} size="lg">
        Send reset link
      </SubmitButton>
    </form>
  );
}
