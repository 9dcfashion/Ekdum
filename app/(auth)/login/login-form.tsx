"use client";

import Link from "next/link";
import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { signInSchema, type SignInInput } from "@/lib/validation/auth";
import { signInAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "", next },
  });
  const errors = form.formState.errors;

  return (
    <form
      className="mt-6 grid gap-4"
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => signInAction(values), {
          onSuccess: ({ redirectTo }) => {
            router.replace(redirectTo);
            router.refresh();
          },
        }),
      )}
    >
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errors.email} {...form.register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...form.register("password")}
        />
      </Field>
      <div className="-mt-2 text-right">
        <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton pending={pending} size="lg" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
