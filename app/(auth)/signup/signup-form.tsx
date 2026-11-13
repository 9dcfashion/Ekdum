"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { signUpSchema, type SignUpInput } from "@/lib/validation/auth";
import { signUpAction } from "../actions";

export function SignupForm() {
  const router = useRouter();
  const { run, pending } = useAction();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { full_name: "", email: "", phone: "", password: "" },
  });
  const errors = form.formState.errors;

  if (sentTo) {
    return (
      <div className="mt-6 rounded-xl border bg-muted/40 p-5 text-center">
        <MailCheck className="mx-auto size-8 text-primary" aria-hidden />
        <p className="mt-3 font-medium">Check your email</p>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to
          verify your email and continue setting up your shop.
        </p>
      </div>
    );
  }

  return (
    <form
      className="mt-6 grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => signUpAction(values), {
          onSuccess: ({ needsVerification }) => {
            if (needsVerification) setSentTo(values.email);
            else {
              router.replace("/onboarding");
              router.refresh();
            }
          },
        }),
      )}
    >
      <Field label="Your name" htmlFor="full_name" error={errors.full_name?.message}>
        <Input id="full_name" autoComplete="name" autoFocus aria-invalid={!!errors.full_name} {...form.register("full_name")} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...form.register("email")} />
      </Field>
      <Field label="Mobile number" htmlFor="phone" error={errors.phone?.message} hint="Optional. 10-digit Indian mobile.">
        <Input id="phone" type="tel" inputMode="numeric" autoComplete="tel" aria-invalid={!!errors.phone} {...form.register("phone")} />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={errors.password?.message}
        hint="At least 8 characters, with a letter and a number."
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...form.register("password")}
        />
      </Field>
      <SubmitButton pending={pending} size="lg" pendingText="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
