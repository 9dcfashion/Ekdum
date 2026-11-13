"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Field } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { outletSchema, type OutletInput } from "@/lib/validation/onboarding";
import { saveFirstOutletAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, applyFieldErrors, useGoToStep } from "./shared";

export function OutletStep({ data }: { data: WizardData }) {
  const b = data.business!;
  const o = data.outlet;
  const goTo = useGoToStep();
  const { run, pending } = useAction();
  const [ownGstin, setOwnGstin] = useState(!!o?.gstin);
  // Prefilled from the business address the first time.
  const form = useForm<OutletInput>({
    resolver: zodResolver(outletSchema),
    defaultValues: {
      name: o?.name ?? "Main Shop",
      address_line1: o?.address_line1 ?? b.address_line1 ?? "",
      address_line2: o?.address_line2 ?? b.address_line2 ?? "",
      city: o?.city ?? b.city ?? "",
      pincode: o?.pincode ?? b.pincode ?? "",
      state_code: o?.state_code ?? b.state_code,
      phone: o?.phone ?? b.phone ?? "",
      gstin: o?.gstin ?? "",
    },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => saveFirstOutletAction(ownGstin ? values : { ...values, gstin: "" }), {
          onSuccess: () => goTo(5),
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Outlet name" htmlFor="name" required error={errors.name?.message} hint="e.g. Main Shop, Andheri Branch">
          <Input id="name" autoFocus {...form.register("name")} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" {...form.register("phone")} />
        </Field>
        <Field label="Address line 1" htmlFor="address_line1" error={errors.address_line1?.message} className="sm:col-span-2">
          <Input id="address_line1" {...form.register("address_line1")} />
        </Field>
        <Field label="Address line 2" htmlFor="address_line2" error={errors.address_line2?.message} className="sm:col-span-2">
          <Input id="address_line2" {...form.register("address_line2")} />
        </Field>
        <Field label="City" htmlFor="city" error={errors.city?.message}>
          <Input id="city" {...form.register("city")} />
        </Field>
        <Field label="PIN code" htmlFor="pincode" error={errors.pincode?.message}>
          <Input id="pincode" inputMode="numeric" maxLength={6} {...form.register("pincode")} />
        </Field>
        <Field label="State" htmlFor="state_code" required error={errors.state_code?.message}>
          <StateSelect id="state_code" {...form.register("state_code")} />
        </Field>

        {b.gst_scheme !== "unregistered" ? (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 accent-[var(--primary)]"
                checked={ownGstin}
                onChange={(e) => setOwnGstin(e.target.checked)}
              />
              <span>
                This outlet has its own GSTIN
                <span className="block text-xs text-muted-foreground">
                  Only needed when the outlet is in a different state from the business. Otherwise bills use{" "}
                  <span className="tabular">{b.gstin}</span>.
                </span>
              </span>
            </label>
            {ownGstin ? (
              <Field label="Outlet GSTIN" htmlFor="gstin" error={errors.gstin?.message} className="mt-3 max-w-xs">
                <Input id="gstin" maxLength={15} className="uppercase tabular" {...form.register("gstin")} />
              </Field>
            ) : null}
          </div>
        ) : null}
      </div>
      <StepFooter step={4} pending={pending} />
    </form>
  );
}
