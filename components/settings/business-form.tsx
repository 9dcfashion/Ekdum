"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DOCUMENT_TITLES, type GstScheme } from "@/lib/gst/config";
import { validateGstin } from "@/lib/gst/gstin";
import { stateName } from "@/lib/gst/states";
import { useAction } from "@/lib/use-action";
import { businessDetailsSchema, type BusinessDetailsInput } from "@/lib/validation/onboarding";
import { saveBusinessProfileAction } from "@/app/app/(shell)/settings/actions";
import { applyFieldErrors } from "./run-confirm";
import { FormFooter } from "./section";

const SCHEMES: Array<{ value: GstScheme; label: string; hint: string; effect: string }> = [
  {
    value: "regular",
    label: "Regular GST",
    hint: "You charge GST and issue tax invoices.",
    effect: `New bills will be a ${DOCUMENT_TITLES.tax_invoice} with GST shown on every line.`,
  },
  {
    value: "composition",
    label: "Composition scheme",
    hint: "You issue a bill of supply and do not charge GST on bills.",
    effect: `New bills will be a ${DOCUMENT_TITLES.bill_of_supply}. No GST is charged or shown on them.`,
  },
  {
    value: "unregistered",
    label: "Not registered under GST",
    hint: "You issue a cash memo with no GST.",
    effect: `New bills will be a ${DOCUMENT_TITLES.cash_memo} with no GST and no GSTIN.`,
  },
];

export interface BusinessProfile {
  legal_name: string;
  trade_name: string | null;
  gst_scheme: GstScheme;
  gstin: string | null;
  pan: string | null;
  state_code: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export function BusinessForm({ business: b }: { business: BusinessProfile }) {
  const { run, pending } = useAction();
  const [toConfirm, setToConfirm] = useState<BusinessDetailsInput | null>(null);
  const form = useForm<BusinessDetailsInput>({
    resolver: zodResolver(businessDetailsSchema),
    defaultValues: {
      legal_name: b.legal_name,
      trade_name: b.trade_name ?? "",
      gst_scheme: b.gst_scheme,
      gstin: b.gstin ?? "",
      pan: b.pan ?? "",
      state_code: b.state_code,
      address_line1: b.address_line1 ?? "",
      address_line2: b.address_line2 ?? "",
      city: b.city ?? "",
      pincode: b.pincode ?? "",
      phone: b.phone ?? "",
      email: b.email ?? "",
    },
  });
  const { errors } = form.formState;
  const scheme = useWatch({ control: form.control, name: "gst_scheme" });
  const gstin = useWatch({ control: form.control, name: "gstin" });
  const registered = scheme !== "unregistered";
  const gstinCheck = registered && gstin && gstin.trim().length >= 15 ? validateGstin(gstin) : null;
  const newScheme = SCHEMES.find((s) => s.value === toConfirm?.gst_scheme);
  const oldScheme = SCHEMES.find((s) => s.value === b.gst_scheme);

  /** A valid GSTIN fills in the state and PAN. */
  function onGstinChange(value: string) {
    const result = validateGstin(value);
    if (result.valid) {
      form.setValue("state_code", result.stateCode!, { shouldValidate: true });
      form.setValue("pan", result.pan!, { shouldValidate: true });
      form.clearErrors("gstin");
    }
  }

  function save(values: BusinessDetailsInput, confirmed: boolean) {
    run(() => saveBusinessProfileAction({ profile: values, confirm_scheme_change: confirmed }), {
      success: "Business profile saved",
      onSuccess: () => {
        setToConfirm(null);
        form.reset(values);
      },
      onError: (_e, fieldErrors) => {
        setToConfirm(null);
        applyFieldErrors(form.setError, fieldErrors, "profile.");
      },
    });
  }

  return (
    <>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => {
          // Changing the scheme changes the document every future bill produces: ask first.
          if (values.gst_scheme !== b.gst_scheme) setToConfirm(values);
          else save(values, false);
        })}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Legal name" htmlFor="legal_name" required error={errors.legal_name?.message} hint="As on your GST certificate or PAN.">
            <Input id="legal_name" aria-invalid={!!errors.legal_name} {...form.register("legal_name")} />
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
            {scheme !== b.gst_scheme ? (
              <p className="mt-2 text-xs text-amber-700" role="status">
                This changes the kind of bill you issue from now on. You will be asked to confirm when you save.
              </p>
            ) : null}
          </fieldset>

          {registered ? (
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
                  "15 characters, e.g. 27AAPFU0939F1ZV. Must belong to the state below."
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
          ) : null}
          <Field label="PAN" htmlFor="pan" error={errors.pan?.message} hint={registered ? "Filled automatically from the GSTIN." : "Optional."}>
            <Input id="pan" maxLength={10} className="uppercase tabular" {...form.register("pan")} />
          </Field>

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
        <p className="mt-4 text-xs text-muted-foreground">
          Changes apply to bills you make from now on. Bills already issued keep the details they were printed with.
        </p>
        <FormFooter>
          <SubmitButton pending={pending && !toConfirm} size="lg">
            Save changes
          </SubmitButton>
        </FormFooter>
      </form>

      <Dialog open={!!toConfirm} onOpenChange={(next) => !next && !pending && setToConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change your GST registration type?</DialogTitle>
            <DialogDescription>
              You are changing from {oldScheme?.label ?? "the current type"} to {newScheme?.label ?? "a new type"}.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid list-disc gap-1.5 pl-4 text-sm">
            <li>{newScheme?.effect}</li>
            <li>This starts with the very next bill, at every outlet and POS counter.</li>
            <li>Bills, credit notes and reports already issued are not changed in any way.</li>
            <li>Make this change only from the date your registration actually changes.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setToConfirm(null)}>
              Cancel
            </Button>
            <SubmitButton type="button" pending={pending} onClick={() => toConfirm && save(toConfirm, true)}>
              Change and save
            </SubmitButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
