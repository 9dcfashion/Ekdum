"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import QRCode from "qrcode";
import { useForm, useWatch } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { Input } from "@/components/ui/input";
import { isValidUpiId, upiPaymentUri } from "@/lib/gst";
import { useAction } from "@/lib/use-action";
import { paymentDetailsSchema, type PaymentDetailsInput } from "@/lib/validation/onboarding";
import { savePaymentDetailsAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, applyFieldErrors, useGoToStep } from "./shared";

export function PaymentStep({ data }: { data: WizardData }) {
  const b = data.business!;
  const goTo = useGoToStep();
  const { run, pending } = useAction();
  const form = useForm<PaymentDetailsInput>({
    resolver: zodResolver(paymentDetailsSchema),
    defaultValues: {
      bank_name: b.bank_name ?? "",
      bank_account_name: b.bank_account_name ?? b.legal_name,
      bank_account_number: b.bank_account_number ?? "",
      ifsc: b.ifsc ?? "",
      upi_id: b.upi_id ?? "",
    },
  });
  const { errors } = form.formState;
  const upiId = useWatch({ control: form.control, name: "upi_id" }) ?? "";
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isValidUpiId(upiId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQr(null);
      return;
    }
    QRCode.toDataURL(upiPaymentUri({ upiId: upiId.trim(), payeeName: b.trade_name || b.legal_name }), { margin: 1, width: 160 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [upiId, b.trade_name, b.legal_name]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => savePaymentDetailsAction(values), {
          onSuccess: () => goTo(4),
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
          <Field label="Account number" htmlFor="bank_account_number" error={errors.bank_account_number?.message}>
            <Input id="bank_account_number" inputMode="numeric" autoComplete="off" className="tabular" {...form.register("bank_account_number")} />
          </Field>
          <Field label="IFSC" htmlFor="ifsc" error={errors.ifsc?.message} hint="e.g. HDFC0001234">
            <Input id="ifsc" maxLength={11} className="uppercase tabular" {...form.register("ifsc")} />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            All of this is optional and only appears on invoices you issue. You can add or change it later in Settings.
          </p>
        </div>

        <div className="flex flex-col items-center justify-start rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-sm font-medium">UPI QR preview</p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="UPI QR code preview" className="mt-3 size-40 rounded bg-white p-1" />
          ) : (
            <div className="mt-3 flex size-40 items-center justify-center rounded border border-dashed bg-background px-3 text-xs text-muted-foreground">
              Enter a UPI ID to see the QR
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">On a bill, the QR also carries the exact amount.</p>
        </div>
      </div>
      <StepFooter step={3} pending={pending} />
    </form>
  );
}
