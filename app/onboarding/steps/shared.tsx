"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";

/** After a step saves, go to the next one. router.refresh() reloads the server data for it. */
export function useGoToStep() {
  const router = useRouter();
  return (step: number) => {
    router.push(`/onboarding?step=${step}`);
    router.refresh();
  };
}

export function StepFooter({
  step,
  pending,
  submitLabel = "Save and continue",
  secondary,
}: {
  step: number;
  pending: boolean;
  submitLabel?: string;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
      {step > 1 ? (
        <Button variant="ghost" asChild>
          <Link href={`/onboarding?step=${step - 1}`}>
            <ArrowLeft aria-hidden /> Back
          </Link>
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {secondary}
        <SubmitButton pending={pending} size="lg">
          {submitLabel}
        </SubmitButton>
      </div>
    </div>
  );
}

/** Push server-side field errors into a react-hook-form instance. */
export function applyFieldErrors(
  setError: (name: never, error: { message: string }) => void,
  fieldErrors: Record<string, string[]> | undefined,
) {
  for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
    if (name !== "_form" && messages[0]) setError(name as never, { message: messages[0] });
  }
}
