"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { SignatoryTitleField } from "@/components/settings/invoice-prefs-form";
import { Field, NativeSelect } from "@/components/shared/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { financialYear } from "@/lib/dates";
import { formatInvoiceNumber, validateSeriesPrefix } from "@/lib/gst";
import { useAction } from "@/lib/use-action";
import { invoiceSettingsSchema, type InvoiceSettingsInput } from "@/lib/validation/onboarding";
import { saveInvoiceSettingsAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, applyFieldErrors, useGoToStep } from "./shared";

export function InvoiceStep({ data }: { data: WizardData }) {
  const b = data.business!;
  const goTo = useGoToStep();
  const { run, pending } = useAction();
  const seriesUsed = !!data.series && data.series.nextNumber > 1;
  const form = useForm<InvoiceSettingsInput>({
    resolver: zodResolver(invoiceSettingsSchema),
    defaultValues: {
      prefix: data.series?.prefix ?? "A",
      start_number: data.series?.nextNumber ?? 1,
      default_print_format: b.default_print_format,
      round_off_enabled: b.round_off_enabled,
      invoice_terms: b.invoice_terms ?? "",
      invoice_footer: b.invoice_footer ?? "Thank you for shopping with us!",
      signatory_label: b.signatory_label || "Authorised Signatory",
    },
  });
  const { errors } = form.formState;
  const prefix = (useWatch({ control: form.control, name: "prefix" }) ?? "").toUpperCase();
  const start = Number(useWatch({ control: form.control, name: "start_number" })) || 1;

  let sample = "";
  if (!validateSeriesPrefix(prefix)) {
    try {
      sample = formatInvoiceNumber(prefix, financialYear(), Math.max(1, Math.floor(start)));
    } catch {
      sample = "";
    }
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => saveInvoiceSettingsAction(values), {
          onSuccess: () => goTo(6),
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Bill number prefix"
          htmlFor="prefix"
          required
          error={errors.prefix?.message}
          hint="Up to 4 letters or digits. Each outlet and billing counter gets its own."
        >
          <Input id="prefix" maxLength={4} disabled={seriesUsed} className="max-w-28 uppercase tabular" {...form.register("prefix")} />
        </Field>
        <Field
          label="Start numbering from"
          htmlFor="start_number"
          error={errors.start_number?.message}
          hint="Keep 1 unless you are moving from other billing software mid-year."
        >
          <Input id="start_number" type="number" min={1} inputMode="numeric" className="max-w-28 tabular" {...form.register("start_number")} />
        </Field>
        <div className="rounded-xl border bg-muted/30 p-3 text-sm sm:col-span-2">
          Your first bill will be numbered{" "}
          <span className="tabular font-semibold">{sample || "—"}</span>
          <span className="block text-xs text-muted-foreground">
            Format: prefix / financial year / running number. Numbers restart every 1 April and are never reused.
          </span>
        </div>

        <Field label="Default print format" htmlFor="default_print_format" error={errors.default_print_format?.message}>
          <NativeSelect id="default_print_format" {...form.register("default_print_format")}>
            <option value="thermal_80">Thermal receipt, 80 mm (3 inch)</option>
            <option value="thermal_58">Thermal receipt, 58 mm (2 inch)</option>
            <option value="a4">A4 invoice</option>
          </NativeSelect>
        </Field>
        <div className="flex items-end">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" {...form.register("round_off_enabled")} />
            <span>
              Round off the bill total to the nearest rupee
              <span className="block text-xs text-muted-foreground">The difference is shown as “Round off” on the bill.</span>
            </span>
          </label>
        </div>

        <Field label="Terms and conditions" htmlFor="invoice_terms" error={errors.invoice_terms?.message} className="sm:col-span-2" hint="Printed on A4 invoices. One per line.">
          <Textarea id="invoice_terms" rows={3} placeholder={"Goods once sold will not be taken back.\nSubject to local jurisdiction."} {...form.register("invoice_terms")} />
        </Field>
        <Field label="Footer note" htmlFor="invoice_footer" error={errors.invoice_footer?.message} className="sm:col-span-2">
          <Input id="invoice_footer" {...form.register("invoice_footer")} />
        </Field>
        <Controller
          control={form.control}
          name="signatory_label"
          render={({ field, fieldState }) => (
            <SignatoryTitleField
              value={field.value ?? ""}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </div>
      <StepFooter step={5} pending={pending} />
    </form>
  );
}
