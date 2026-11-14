"use client";

import { useAppRouter as useRouter } from "@/lib/use-app-router";
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
import { formatDateTime } from "@/lib/dates";
import { formatMobile, validateGstin } from "@/lib/gst";
import type { ActionResult } from "@/lib/actions";
import type { Customer } from "@/lib/types/db";
import { useAction } from "@/lib/use-action";
import { customerSchema, type CustomerData, type CustomerInput } from "@/lib/validation/parties";
import { applyFieldErrors } from "./form-utils";
import { GstinHint } from "./gstin-hint";

export interface CustomerFormProps {
  /** The customer being edited; omit to create a new one. */
  customer?: Customer;
  /** False shows the details read-only (user has `customers.view` only). */
  canManage?: boolean;
  saveAction: (id: string | null, input: unknown) => Promise<ActionResult<{ id: string }>>;
  deleteAction?: (id: string) => Promise<ActionResult<unknown>>;
}

export function CustomerForm({ customer, canManage = true, saveAction, deleteAction }: CustomerFormProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const { run: runDelete } = useAction();
  const form = useForm<CustomerInput, unknown, CustomerData>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: customer?.name ?? "",
      phone: customer?.phone ? formatMobile(customer.phone) : "",
      email: customer?.email ?? "",
      gstin: customer?.gstin ?? "",
      address_line1: customer?.address_line1 ?? "",
      address_line2: customer?.address_line2 ?? "",
      city: customer?.city ?? "",
      pincode: customer?.pincode ?? "",
      state_code: customer?.state_code ?? "",
      notes: customer?.notes ?? "",
      whatsapp_opt_in: customer?.whatsapp_opt_in ?? false,
    },
  });
  const { errors } = form.formState;
  const gstin = useWatch({ control: form.control, name: "gstin" });
  const optedIn = useWatch({ control: form.control, name: "whatsapp_opt_in" });

  const onSubmit = form.handleSubmit((values) =>
    run(() => saveAction(customer?.id ?? null, values), {
      success: customer ? "Customer saved" : "Customer added",
      onSuccess: (saved) => {
        if (customer) {
          form.reset(form.getValues());
          router.refresh();
        } else {
          router.push(`/app/customers/${saved.id}`);
        }
      },
      onError: (_error, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
    }),
  );

  return (
    <form noValidate onSubmit={onSubmit} className="max-w-3xl">
      <fieldset disabled={!canManage} className="grid gap-5">
        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">Contact</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="name" autoFocus={!customer} autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="Mobile number" htmlFor="phone" error={errors.phone?.message} hint="10-digit Indian mobile number">
              <Input
                id="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                maxLength={16}
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
          <h2 className="text-sm font-semibold">Business customer (B2B)</h2>
          <p className="mt-0.5 mb-4 text-xs text-muted-foreground">
            Add a GSTIN to bill this customer with a tax invoice they can claim input credit on.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="GSTIN" htmlFor="gstin" error={errors.gstin?.message}>
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
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">Billing address</h2>
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
              hint="Filled in automatically from a valid GSTIN"
            >
              <StateSelect id="state_code" aria-invalid={!!errors.state_code} {...form.register("state_code")} />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">WhatsApp and notes</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("whatsapp_opt_in")} />
            <span>
              Customer has agreed to receive bills on WhatsApp
              <span className="block text-xs text-muted-foreground">
                Tick this only after the customer says yes. Bills are sent to the mobile number above.
              </span>
            </span>
          </label>
          {customer?.whatsapp_opt_in && customer.whatsapp_opt_in_at && optedIn ? (
            <p className="mt-2 pl-6 text-xs text-muted-foreground">
              Consent recorded on <span className="tabular">{formatDateTime(customer.whatsapp_opt_in_at)}</span>
            </p>
          ) : optedIn ? (
            <p className="mt-2 pl-6 text-xs text-muted-foreground">The date and time of consent is recorded when you save.</p>
          ) : null}

          <Field label="Notes" htmlFor="notes" error={errors.notes?.message} hint="Only your staff can see this" className="mt-4">
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </Field>
        </section>
      </fieldset>

      {canManage ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SubmitButton size="lg" pending={pending} pendingText="Saving…">
              {customer ? "Save changes" : "Add customer"}
            </SubmitButton>
            {customer ? null : (
              <Button type="button" variant="ghost" size="lg" onClick={() => router.push("/app/customers")}>
                Cancel
              </Button>
            )}
          </div>
          {customer && deleteAction ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="destructive">
                  <Trash2 aria-hidden /> Delete customer
                </Button>
              }
              title={`Delete ${customer.name}?`}
              description="Past bills are not changed: they keep this customer's name, phone and GSTIN exactly as printed. Only the saved customer record is removed. This cannot be undone."
              confirmLabel="Delete customer"
              destructive
              onConfirm={() =>
                new Promise<boolean>((resolve) =>
                  runDelete(() => deleteAction(customer.id), {
                    success: "Customer deleted",
                    onSuccess: () => {
                      resolve(true);
                      router.push("/app/customers");
                    },
                    onError: () => resolve(false),
                  }),
                )
              }
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">You can view customers but not change them.</p>
      )}
    </form>
  );
}
