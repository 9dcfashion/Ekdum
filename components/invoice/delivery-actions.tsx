"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, MessageCircle, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { retryInvoiceReceiptAction, sendInvoiceReceiptAction } from "@/lib/notifications/actions";
import { sendReceiptEmailSchema, type SendReceiptEmailInput } from "@/lib/notifications/schema";
import { useAction } from "@/lib/use-action";

/** The message is sent just after the action returns, so look again a little later for the new status. */
function useRefreshSoon() {
  const router = useRouter();
  return () => {
    router.refresh();
    window.setTimeout(() => router.refresh(), 2500);
    window.setTimeout(() => router.refresh(), 8000);
  };
}

export function ResendButton({ jobId, invoiceId, label }: { jobId: string; invoiceId: string; label: string }) {
  const { run, pending } = useAction();
  const refreshSoon = useRefreshSoon();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      onClick={() =>
        run(() => retryInvoiceReceiptAction({ jobId, invoiceId }), {
          success: "Sending again",
          onSuccess: refreshSoon,
        })
      }
    >
      <RotateCw className={pending ? "animate-spin" : undefined} aria-hidden />
      Resend
    </Button>
  );
}

export function SendEmailForm({
  invoiceId,
  defaultEmail,
  disabledReason,
}: {
  invoiceId: string;
  defaultEmail: string;
  disabledReason: string | null;
}) {
  const { run, pending } = useAction();
  const refreshSoon = useRefreshSoon();
  const form = useForm<SendReceiptEmailInput>({
    resolver: zodResolver(sendReceiptEmailSchema),
    defaultValues: { email: defaultEmail },
  });
  const error = form.formState.errors.email?.message;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => sendInvoiceReceiptAction({ channel: "email", invoiceId, email: values.email }), {
          success: "Email is on its way",
          onSuccess: refreshSoon,
          onError: (_message, fieldErrors) => {
            const fieldError = fieldErrors?.email?.[0];
            if (fieldError) form.setError("email", { message: fieldError });
          },
        }),
      )}
    >
      <Field label="Send by email" htmlFor="receipt-email" error={error} hint={disabledReason ?? undefined}>
        <div className="flex gap-2">
          <Input
            id="receipt-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="customer@example.com"
            disabled={!!disabledReason}
            aria-invalid={!!error}
            className="min-w-0 flex-1"
            {...form.register("email")}
          />
          <SubmitButton pending={pending} disabled={!!disabledReason} variant="outline">
            <Mail aria-hidden />
            Send
          </SubmitButton>
        </div>
      </Field>
    </form>
  );
}

export function SendWhatsAppButton({
  invoiceId,
  maskedPhone,
  disabledReason,
}: {
  invoiceId: string;
  maskedPhone: string | null;
  disabledReason: string | null;
}) {
  const { run, pending } = useAction();
  const refreshSoon = useRefreshSoon();
  return (
    <div className="grid gap-1.5">
      <p className="text-sm font-medium">Send on WhatsApp</p>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !!disabledReason}
          aria-busy={pending}
          aria-describedby="receipt-whatsapp-hint"
          onClick={() =>
            run(() => sendInvoiceReceiptAction({ channel: "whatsapp", invoiceId }), {
              success: "WhatsApp message is on its way",
              onSuccess: refreshSoon,
            })
          }
        >
          <MessageCircle aria-hidden />
          {maskedPhone ? `Send to ${maskedPhone}` : "Send on WhatsApp"}
        </Button>
      </div>
      <p id="receipt-whatsapp-hint" className="text-xs text-muted-foreground">
        {disabledReason ?? "Sent to the customer's number on this bill, with the PDF attached."}
      </p>
    </div>
  );
}
