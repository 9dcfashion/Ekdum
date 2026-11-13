"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { validateGstin } from "@/lib/gst";
import type { ActionResult } from "@/lib/actions";
import type { Vendor } from "@/lib/types/db";
import { useAction } from "@/lib/use-action";
import { vendorSchema, type VendorData, type VendorInput } from "@/lib/validation/parties";
import { applyFieldErrors } from "./form-utils";
import { GstinHint } from "./gstin-hint";

export interface VendorFormProps {
  /** The vendor being edited; omit to create a new one. */
  vendor?: Vendor;
  /** False shows the details read-only (user has `purchases.view` but not `vendors.manage`). */
  canManage?: boolean;
  saveAction: (id: string | null, input: unknown) => Promise<ActionResult<{ id: string }>>;
  deleteAction?: (id: string) => Promise<ActionResult<unknown>>;
}

export function VendorForm({ vendor, canManage = true, saveAction, deleteAction }: VendorFormProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const { run: runDelete } = useAction();
  const form = useForm<VendorInput, unknown, VendorData>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: vendor?.name ?? "",
      gstin: vendor?.gstin ?? "",
      phone: vendor?.phone ?? "",
      email: vendor?.email ?? "",
      address_line1: vendor?.address_line1 ?? "",
      address_line2: vendor?.address_line2 ?? "",
      city: vendor?.city ?? "",
      pincode: vendor?.pincode ?? "",
      state_code: vendor?.state_code ?? "",
      notes: vendor?.notes ?? "",
      is_active: vendor?.is_active ?? true,
    },
  });
  const { errors } = form.formState;
  const gstin = useWatch({ control: form.control, name: "gstin" });

  const onSubmit = form.handleSubmit((values) =>
    run(() => saveAction(vendor?.id ?? null, values), {
      success: vendor ? "Vendor saved" : "Vendor added",
      onSuccess: (saved) => {
        if (vendor) {
          form.reset(form.getValues());
          router.refresh();
        } else {
          router.push(`/app/vendors/${saved.id}`);
        }
      },
      onError: (_error, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
    }),
  );

  return (
    <form noValidate onSubmit={onSubmit} className="max-w-3xl">
      <fieldset disabled={!canManage} className="grid gap-5">
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">Vendor details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="name" autoFocus={!vendor} autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="GSTIN" htmlFor="gstin" error={errors.gstin?.message} className="sm:col-span-2 sm:max-w-sm">
              <Input
                id="gstin"
                maxLength={15}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="uppercase tabular"
                aria-invalid={!!errors.gstin}
                {...form.register("gstin", {
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    // A valid GSTIN tells us the state: fill it in.
                    const result = validateGstin(event.target.value);
                    if (result.valid && result.stateCode) {
                      form.setValue("state_code", result.stateCode, { shouldDirty: true, shouldValidate: true });
                    }
                  },
                })}
              />
              {errors.gstin ? null : <GstinHint value={gstin} />}
            </Field>
            <Field label="Phone" htmlFor="phone" error={errors.phone?.message} hint="Mobile or landline">
              <Input
                id="phone"
                type="tel"
                autoComplete="off"
                maxLength={20}
                className="tabular"
                aria-invalid={!!errors.phone}
                {...form.register("phone")}
              />
            </Field>
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input id="email" type="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">Address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
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
              <Input
                id="pincode"
                inputMode="numeric"
                maxLength={6}
                className="tabular"
                aria-invalid={!!errors.pincode}
                {...form.register("pincode")}
              />
            </Field>
            <Field
              label="State"
              htmlFor="state_code"
              error={errors.state_code?.message}
              hint="Decides CGST + SGST or IGST on purchases. Filled in from a valid GSTIN."
            >
              <StateSelect id="state_code" aria-invalid={!!errors.state_code} {...form.register("state_code")} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">Status and notes</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("is_active")} />
            <span>
              Active
              <span className="block text-xs text-muted-foreground">
                Inactive vendors are kept for old bills but are not offered when entering a new purchase.
              </span>
            </span>
          </label>
          <Field label="Notes" htmlFor="notes" error={errors.notes?.message} className="mt-4">
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </Field>
        </section>
      </fieldset>

      {canManage ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SubmitButton size="lg" pending={pending} pendingText="Saving…">
              {vendor ? "Save changes" : "Add vendor"}
            </SubmitButton>
            {vendor ? null : (
              <Button type="button" variant="ghost" size="lg" onClick={() => router.push("/app/vendors")}>
                Cancel
              </Button>
            )}
          </div>
          {vendor && deleteAction ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive">
                  <Trash2 aria-hidden /> Delete vendor
                </Button>
              }
              title={`Delete ${vendor.name}?`}
              description="A vendor can be deleted only if no purchase bill uses it. If it has bills, mark it inactive instead. This cannot be undone."
              confirmLabel="Delete vendor"
              destructive
              onConfirm={() =>
                new Promise<boolean>((resolve) =>
                  runDelete(() => deleteAction(vendor.id), {
                    success: "Vendor deleted",
                    onSuccess: () => {
                      resolve(true);
                      router.push("/app/vendors");
                    },
                    onError: () => resolve(false),
                  }),
                )
              }
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">You can view vendors but not change them.</p>
      )}
    </form>
  );
}
