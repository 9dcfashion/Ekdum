"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import QRCode from "qrcode";
import { useForm, useWatch } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { upiPaymentUri } from "@/lib/gst/document";
import { isValidUpiId } from "@/lib/gst/validators";
import { useAction } from "@/lib/use-action";
import { paymentDetailsSchema, type PaymentDetailsInput } from "@/lib/validation/onboarding";
import { savePaymentSettingsAction } from "@/app/app/(shell)/settings/actions";
import { applyFieldErrors } from "./run-confirm";
import { FormFooter } from "./section";

export function PaymentsForm({
  payeeName,
  initial,
}: {
  payeeName: string;
  initial: { bank_name: string | null; bank_account_name: string | null; bank_account_number: string | null; ifsc: string | null; upi_id: string | null };
}) {
  const { run, pending } = useAction();
  const form = useForm<PaymentDetailsInput>({
    resolver: zodResolver(paymentDetailsSchema),
    defaultValues: {
      bank_name: initial.bank_name ?? "",
      bank_account_name: initial.bank_account_name ?? "",
      bank_account_number: initial.bank_account_number ?? "",
      ifsc: initial.ifsc ?? "",
      upi_id: initial.upi_id ?? "",
    },
  });
  const { errors } = form.formState;
  const upiId = (useWatch({ control: form.control, name: "upi_id" }) ?? "").trim();
  const upiValid = isValidUpiId(upiId);
  // The QR is kept with the UPI ID it was made for, so a stale one is never shown.
  const [qr, setQr] = useState<{ upiId: string; url: string } | null>(null);

  useEffect(() => {
    if (!upiValid) return;
    let cancelled = false;
    QRCode.toDataURL(upiPaymentUri({ upiId, payeeName }), { margin: 1, width: 160 })
      .then((url) => !cancelled && setQr({ upiId, url }))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [upiId, upiValid, payeeName]);

  const qrUrl = upiValid && qr?.upiId === upiId ? qr.url : null;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => savePaymentSettingsAction(values), {
          success: "Payment details saved",
          onSuccess: () => form.reset(values),
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="grid content-start gap-5 sm:grid-cols-2">
          <Field label="UPI ID" htmlFor="upi_id" error={errors.upi_id?.message} hint="Shown as a scan-to-pay QR on every bill." className="sm:col-span-2">
            <Input id="upi_id" placeholder="yourshop@okhdfcbank" autoCapitalize="none" spellCheck={false} {...form.register("upi_id")} />
          </Field>
          <Field label="Bank name" htmlFor="bank_name" error={errors.bank_name?.message}>
            <Input id="bank_name" {...form.register("bank_name")} />
          </Field>
          <Field label="Account holder name" htmlFor="bank_account_name" error={errors.bank_account_name?.message}>
            <Input id="bank_account_name" {...form.register("bank_account_name")} />
          </Field>
          <Field
            label="Account number"
            htmlFor="bank_account_number"
            error={errors.bank_account_number?.message}
            hint="Shown in full only here. Everywhere else in the app only the last 4 digits appear."
          >
            <Input id="bank_account_number" inputMode="numeric" autoComplete="off" className="tabular" {...form.register("bank_account_number")} />
          </Field>
          <Field label="IFSC" htmlFor="ifsc" error={errors.ifsc?.message} hint="e.g. HDFC0001234">
            <Input id="ifsc" maxLength={11} className="uppercase tabular" {...form.register("ifsc")} />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            All of this is optional. Bank details are printed on A4 invoices so customers can pay by transfer. Check them
            carefully: money goes wherever these details point.
          </p>
        </div>

        <div className="flex flex-col items-center justify-start rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-sm font-medium">UPI QR preview</p>
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrUrl} alt="UPI QR code preview" className="mt-3 size-40 rounded bg-white p-1" />
          ) : (
            <div className="mt-3 flex size-40 items-center justify-center rounded border border-dashed bg-background px-3 text-xs text-muted-foreground">
              Enter a UPI ID to see the QR
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">On a bill, the QR also carries the exact amount.</p>
        </div>
      </div>
      <FormFooter>
        <SubmitButton pending={pending} size="lg">
          Save payment details
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
