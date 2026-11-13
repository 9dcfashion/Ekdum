"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { Input } from "@/components/ui/input";
import { stateName, validateGstin } from "@/lib/gst";
import { useAction } from "@/lib/use-action";
import { businessDetailsSchema, type BusinessDetailsInput } from "@/lib/validation/onboarding";
import { saveBusinessDetailsAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, applyFieldErrors, useGoToStep } from "./shared";

const SCHEMES = [
  { value: "regular", label: "Regular GST", hint: "You charge GST and issue tax invoices." },
  { value: "composition", label: "Composition scheme", hint: "You issue a bill of supply and do not charge GST on bills." },
  { value: "unregistered", label: "Not registered under GST", hint: "You issue a cash memo with no GST." },
] as const;

export function BusinessStep({ data }: { data: WizardData }) {
  const b = data.business;
  const goTo = useGoToStep();
  const { run, pending } = useAction();
  const form = useForm<BusinessDetailsInput>({
    resolver: zodResolver(businessDetailsSchema),
    defaultValues: {
      legal_name: b?.legal_name ?? "",
      trade_name: b?.trade_name ?? "",
      gst_scheme: b?.gst_scheme ?? "regular",
      gstin: b?.gstin ?? "",
      pan: b?.pan ?? "",
      state_code: b?.state_code ?? "",
      address_line1: b?.address_line1 ?? "",
      address_line2: b?.address_line2 ?? "",
      city: b?.city ?? "",
      pincode: b?.pincode ?? "",
      phone: b?.phone ?? "",
      email: b?.email ?? data.userEmail,
    },
  });
  const { errors } = form.formState;
  const scheme = useWatch({ control: form.control, name: "gst_scheme" });
  const gstin = useWatch({ control: form.control, name: "gstin" });
  const registered = scheme !== "unregistered";
  const gstinCheck = registered && gstin && gstin.trim().length >= 15 ? validateGstin(gstin) : null;

  /** Validate as the user types; a valid GSTIN fills in the state and PAN. */
  function onGstinChange(value: string) {
    const result = validateGstin(value);
    if (result.valid) {
      form.setValue("state_code", result.stateCode!, { shouldValidate: true });
      form.setValue("pan", result.pan!, { shouldValidate: true });
      form.clearErrors("gstin");
    }
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => saveBusinessDetailsAction(values, data.createNew), {
          onSuccess: () => goTo(2),
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Legal name" htmlFor="legal_name" required error={errors.legal_name?.message} hint="As on your GST certificate or PAN.">
          <Input id="legal_name" autoFocus aria-invalid={!!errors.legal_name} {...form.register("legal_name")} />
        </Field>
        <Field label="Shop / trade name" htmlFor="trade_name" error={errors.trade_name?.message} hint="The name customers know you by.">
          <Input id="trade_name" {...form.register("trade_name")} />
        </Field>

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">GST registration</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SCHEMES.map((s) => (
              <label
                key={s.value}
                className="flex cursor-pointer gap-2.5 rounded-xl border p-3 text-sm transition-colors has-checked:border-primary has-checked:bg-primary/5"
              >
                <input type="radio" value={s.value} className="mt-0.5 accent-[var(--primary)]" {...form.register("gst_scheme")} />
                <span>
                  <span className="block font-medium">{s.label}</span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {registered ? (
          <>
            <Field
              label="GSTIN"
              htmlFor="gstin"
              required
              error={errors.gstin?.message ?? (gstinCheck && !gstinCheck.valid ? gstinCheck.message : undefined)}
              hint={
                gstinCheck?.valid ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="size-3.5" aria-hidden /> Valid GSTIN · {stateName(gstinCheck.stateCode)}
                  </span>
                ) : (
                  "15 characters, e.g. 27AAPFU0939F1ZV"
                )
              }
            >
              <Input
                id="gstin"
                maxLength={15}
                autoCapitalize="characters"
                spellCheck={false}
                className="uppercase tabular"
                aria-invalid={!!errors.gstin}
                {...form.register("gstin", { onChange: (e) => onGstinChange(e.target.value) })}
              />
            </Field>
            <Field label="PAN" htmlFor="pan" error={errors.pan?.message} hint="Filled automatically from the GSTIN.">
              <Input id="pan" maxLength={10} className="uppercase tabular" {...form.register("pan")} />
            </Field>
          </>
        ) : (
          <Field label="PAN" htmlFor="pan" error={errors.pan?.message} hint="Optional.">
            <Input id="pan" maxLength={10} className="uppercase tabular" {...form.register("pan")} />
          </Field>
        )}

        <Field label="Address line 1" htmlFor="address_line1" error={errors.address_line1?.message} className="sm:col-span-2">
          <Input id="address_line1" autoComplete="address-line1" {...form.register("address_line1")} />
        </Field>
        <Field label="Address line 2" htmlFor="address_line2" error={errors.address_line2?.message} className="sm:col-span-2">
          <Input id="address_line2" autoComplete="address-line2" {...form.register("address_line2")} />
        </Field>
        <Field label="City" htmlFor="city" error={errors.city?.message}>
          <Input id="city" autoComplete="address-level2" {...form.register("city")} />
        </Field>
        <Field label="PIN code" htmlFor="pincode" error={errors.pincode?.message}>
          <Input id="pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code" {...form.register("pincode")} />
        </Field>
        <Field label="State" htmlFor="state_code" required error={errors.state_code?.message}>
          <StateSelect id="state_code" aria-invalid={!!errors.state_code} {...form.register("state_code")} />
        </Field>
        <Field label="Business phone" htmlFor="phone" error={errors.phone?.message} hint="Printed on your bills.">
          <Input id="phone" type="tel" autoComplete="tel" {...form.register("phone")} />
        </Field>
        <Field label="Business email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
        </Field>
      </div>
      <StepFooter step={1} pending={pending} />
    </form>
  );
}
