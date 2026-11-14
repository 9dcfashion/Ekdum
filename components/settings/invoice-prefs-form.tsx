"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Printer } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { MiniInvoicePreview } from "@/components/invoice/mini-preview";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { logoUrl } from "@/lib/storage";
import { useAction } from "@/lib/use-action";
import { SIGNATORY_TITLES } from "@/lib/validation/onboarding";
import { invoicePrefsFormSchema, type InvoicePrefsInput } from "@/lib/validation/settings";
import { saveInvoicePrefsAction } from "@/app/app/(shell)/settings/actions";
import type { PreviewBusiness } from "./branding-form";
import { applyFieldErrors } from "./run-confirm";
import { CheckRow, FormFooter, InfoBox } from "./section";

export interface InvoicePrefs {
  default_print_format: "a4" | "thermal_80" | "thermal_58";
  round_off_enabled: boolean;
  invoice_terms: string | null;
  invoice_footer: string | null;
  signatory_label: string;
  hsn_digits: 4 | 6 | 8;
  bos_for_exempt_only: boolean;
  cancel_window_days: number | null;
  allow_negative_stock: boolean;
  stuck_shipment_days: number;
}

const RADIO = "mt-0.5 accent-[var(--primary)]";

const OTHER_TITLE = "__other";
const isPresetTitle = (value: string) => (SIGNATORY_TITLES as readonly string[]).includes(value);

/**
 * "Signature title" printed under "For {shop}" on bills: the usual titles, plus "Other"
 * with a text box. Controlled; also used by the onboarding invoice step.
 */
export function SignatoryTitleField({
  value,
  onChange,
  onBlur,
  error,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  className?: string;
}) {
  const [other, setOther] = useState(() => !isPresetTitle(value));

  return (
    <Field
      label="Signature title"
      htmlFor="signatory_label_choice"
      required
      error={error}
      hint="Printed under “For your shop name” where the bill is signed."
      className={className}
    >
      <NativeSelect
        id="signatory_label_choice"
        value={other ? OTHER_TITLE : value}
        onChange={(e) => {
          const next = e.target.value;
          setOther(next === OTHER_TITLE);
          onChange(next === OTHER_TITLE ? "" : next);
        }}
        onBlur={onBlur}
      >
        {SIGNATORY_TITLES.map((title) => (
          <option key={title} value={title}>
            {title}
          </option>
        ))}
        <option value={OTHER_TITLE}>Other</option>
      </NativeSelect>
      {other ? (
        <Input
          id="signatory_label"
          aria-label="Your signature title"
          placeholder="e.g. Owner"
          maxLength={40}
          value={value}
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      ) : null}
    </Field>
  );
}

export function InvoicePrefsForm({
  prefs,
  preview,
  logoPath,
  brandColor,
  chargesTax,
}: {
  prefs: InvoicePrefs;
  preview: PreviewBusiness;
  logoPath: string | null;
  brandColor: string;
  /** Regular GST scheme: only then is the exempt-items choice relevant. */
  chargesTax: boolean;
}) {
  const { run, pending } = useAction();
  const form = useForm<InvoicePrefsInput>({
    resolver: zodResolver(invoicePrefsFormSchema),
    defaultValues: {
      default_print_format: prefs.default_print_format,
      round_off_enabled: prefs.round_off_enabled,
      invoice_terms: prefs.invoice_terms ?? "",
      invoice_footer: prefs.invoice_footer ?? "",
      signatory_label: prefs.signatory_label,
      hsn_digits: String(prefs.hsn_digits) as "4" | "6" | "8",
      bos_for_exempt_only: prefs.bos_for_exempt_only,
      cancel_window_mode: prefs.cancel_window_days === null ? "no_limit" : prefs.cancel_window_days === 0 ? "same_day" : "days",
      cancel_window_days: prefs.cancel_window_days && prefs.cancel_window_days > 0 ? String(prefs.cancel_window_days) : "3",
      allow_negative_stock: prefs.allow_negative_stock,
      stuck_shipment_days: String(prefs.stuck_shipment_days),
    },
  });
  const { errors } = form.formState;
  const footer = useWatch({ control: form.control, name: "invoice_footer" });
  const signatory = useWatch({ control: form.control, name: "signatory_label" });
  const cancelMode = useWatch({ control: form.control, name: "cancel_window_mode" });
  const allowNegative = useWatch({ control: form.control, name: "allow_negative_stock" });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => saveInvoicePrefsAction(values), {
          success: "Invoice settings saved",
          onSuccess: () => form.reset(values),
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Default print format"
              htmlFor="default_print_format"
              error={errors.default_print_format?.message}
              hint="What the POS prints first. You can still pick another format for any bill."
            >
              <NativeSelect id="default_print_format" {...form.register("default_print_format")}>
                <option value="thermal_80">Thermal receipt, 80 mm (3 inch)</option>
                <option value="thermal_58">Thermal receipt, 58 mm (2 inch)</option>
                <option value="a4">A4 invoice</option>
              </NativeSelect>
            </Field>
            <Field
              label="HSN digits on invoices"
              htmlFor="hsn_digits"
              error={errors.hsn_digits?.message}
              hint="Longer codes saved on products are shortened to this many digits when printed. Ask your accountant which applies to you."
            >
              <NativeSelect id="hsn_digits" {...form.register("hsn_digits")}>
                <option value="4">4 digits</option>
                <option value="6">6 digits</option>
                <option value="8">8 digits</option>
              </NativeSelect>
            </Field>
          </div>

          <div className="grid gap-3">
            <CheckRow
              title="Round off the bill total to the nearest rupee"
              hint="The difference is shown as “Round off” on the bill."
              {...form.register("round_off_enabled")}
            />
            {chargesTax ? (
              <CheckRow
                title="Issue a Bill of Supply when a bill has only exempt or nil-rated items"
                hint="When off, such bills are still issued as a Tax Invoice with 0% GST."
                {...form.register("bos_for_exempt_only")}
              />
            ) : null}
          </div>

          <Field label="Terms and conditions" htmlFor="invoice_terms" error={errors.invoice_terms?.message} hint="Printed on A4 invoices. One per line.">
            <Textarea id="invoice_terms" rows={3} placeholder={"Goods once sold will not be taken back.\nSubject to local jurisdiction."} {...form.register("invoice_terms")} />
          </Field>
          <Field label="Footer note" htmlFor="invoice_footer" error={errors.invoice_footer?.message} hint="A short line at the bottom of every bill.">
            <Input id="invoice_footer" maxLength={300} {...form.register("invoice_footer")} />
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
                className="max-w-sm"
              />
            )}
          />

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">How long can a bill be cancelled?</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" value="same_day" className={RADIO} {...form.register("cancel_window_mode")} />
              <span>
                Only on the day it was made
                <span className="block text-xs text-muted-foreground">After that, issue a credit note instead. Safest for GST returns.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" value="days" className={RADIO} {...form.register("cancel_window_mode")} />
              <span>Within a number of days</span>
            </label>
            {cancelMode === "days" ? (
              <Field label="Days" htmlFor="cancel_window_days" error={errors.cancel_window_days?.message} className="ml-6 max-w-40">
                <Input id="cancel_window_days" type="number" min={1} max={365} inputMode="numeric" className="tabular" {...form.register("cancel_window_days")} />
              </Field>
            ) : null}
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" value="no_limit" className={RADIO} {...form.register("cancel_window_mode")} />
              <span>
                No limit
                <span className="block text-xs text-muted-foreground">
                  Not recommended: cancelling a bill from a month you have already filed changes your returns.
                </span>
              </span>
            </label>
            <p className="text-xs text-muted-foreground">Cancelled bills keep their number and stay in your records.</p>
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">When stock is not enough for a sale</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="negative-stock"
                className={RADIO}
                checked={allowNegative}
                onChange={() => form.setValue("allow_negative_stock", true, { shouldDirty: true })}
              />
              <span>
                Warn, but allow the sale
                <span className="block text-xs text-muted-foreground">
                  Stock can go below zero. Useful when purchases are entered after the goods are already selling.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="negative-stock"
                className={RADIO}
                checked={!allowNegative}
                onChange={() => form.setValue("allow_negative_stock", false, { shouldDirty: true })}
              />
              <span>
                Block the sale
                <span className="block text-xs text-muted-foreground">The bill cannot be saved until stock is added or the quantity is reduced.</span>
              </span>
            </label>
          </fieldset>

          <Field
            label="Flag a shipment as stuck after"
            htmlFor="stuck_shipment_days"
            error={errors.stuck_shipment_days?.message}
            hint="Days without a status update before a shipment is highlighted on the dashboard."
            className="max-w-xs"
          >
            <div className="flex items-center gap-2">
              <Input id="stuck_shipment_days" type="number" min={1} max={60} inputMode="numeric" className="max-w-24 tabular" {...form.register("stuck_shipment_days")} />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </Field>
        </div>

        <div className="grid content-start gap-4">
          <div>
            <p className="mb-2 text-sm font-medium">Live preview</p>
            <MiniInvoicePreview
              name={preview.name}
              address={preview.address}
              gstin={preview.gstin}
              stateCode={preview.stateCode}
              logoUrl={logoUrl(logoPath)}
              brandColor={brandColor}
              documentType={preview.documentType}
              prefix={preview.prefix}
              footer={footer}
              tagline={preview.tagline}
              signatoryLabel={signatory}
            />
          </div>
          <InfoBox>
            <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
              <Printer className="size-4" aria-hidden /> Setting up your printer
            </p>
            <ol>
              <li>Open any bill and choose Print. Your browser&apos;s print window opens.</li>
              <li>Under Destination or Printer, choose your thermal printer.</li>
              <li>Set the paper size to 80 mm (or 58 mm for a 2 inch printer).</li>
              <li>Set Margins to None.</li>
              <li>Switch off &quot;Headers and footers&quot;.</li>
              <li>Keep Scale at 100%.</li>
            </ol>
            <p className="mt-2">The browser remembers these choices for next time. For A4 invoices, pick your regular printer and A4 paper.</p>
          </InfoBox>
        </div>
      </div>
      <FormFooter>
        <SubmitButton pending={pending} size="lg">
          Save invoice settings
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
