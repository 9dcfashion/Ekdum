"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createProductInlineAction, createVendorInlineAction } from "@/app/app/(shell)/purchases/actions";
import { stateName, validateGstin } from "@/lib/gst";
import type { GstRateOption, PurchaseProductOption, UnitOption, VendorOption } from "@/lib/purchases/types";
import { useAction } from "@/lib/use-action";
import {
  quickPurchaseProductSchema,
  quickVendorSchema,
  type QuickPurchaseProductInput,
  type QuickVendorInput,
} from "@/lib/validation/purchases";
import { applyFieldErrors } from "./form-helpers";

/** Small "new vendor" dialog for the purchase form. `initialName` is the typed name, or null when closed. */
export function QuickVendorDialog({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string | null;
  onClose: () => void;
  onCreated: (vendor: VendorOption) => void;
}) {
  return (
    <Dialog open={initialName !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New vendor</DialogTitle>
          <DialogDescription>Just the basics. You can add the address and other details later under Vendors.</DialogDescription>
        </DialogHeader>
        {initialName !== null ? <VendorForm initialName={initialName} onClose={onClose} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function VendorForm({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (vendor: VendorOption) => void }) {
  const { run, pending } = useAction();
  const form = useForm<QuickVendorInput>({
    resolver: zodResolver(quickVendorSchema),
    defaultValues: { name: initialName, gstin: "", phone: "", state_code: "" },
  });
  const { errors } = form.formState;
  const gstin = useWatch({ control: form.control, name: "gstin" });
  const parsed = validateGstin(gstin);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.stopPropagation();
        void form.handleSubmit(() =>
          run(() => createVendorInlineAction(form.getValues()), {
            success: "Vendor created",
            onSuccess: (vendor) => {
              onCreated(vendor);
              onClose();
            },
            onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
          }),
        )(e);
      }}
    >
      <Field label="Vendor name" htmlFor="qv-name" required error={errors.name?.message}>
        <Input id="qv-name" autoFocus autoComplete="off" {...form.register("name")} />
      </Field>
      <Field
        label="GSTIN"
        htmlFor="qv-gstin"
        error={errors.gstin?.message}
        hint={parsed.valid ? `Registered in ${stateName(parsed.stateCode)}` : "Leave blank if the vendor is not registered for GST"}
      >
        <Input id="qv-gstin" maxLength={15} autoComplete="off" className="tabular uppercase" {...form.register("gstin")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" htmlFor="qv-phone" error={errors.phone?.message}>
          <Input id="qv-phone" type="tel" autoComplete="off" {...form.register("phone")} />
        </Field>
        <Field label="State" htmlFor="qv-state" error={errors.state_code?.message} hint={parsed.valid ? "Taken from the GSTIN" : undefined}>
          <StateSelect id="qv-state" disabled={parsed.valid} {...form.register("state_code")} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>Create vendor</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** Small "new product" dialog for the purchase form. `initialName` is null when closed. */
export function QuickProductDialog({
  initialName,
  units,
  gstRates,
  onClose,
  onCreated,
}: {
  initialName: string | null;
  units: UnitOption[];
  gstRates: GstRateOption[];
  onClose: () => void;
  onCreated: (product: PurchaseProductOption) => void;
}) {
  return (
    <Dialog open={initialName !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>
            It is added to your product list and to this bill. Stock goes up when the bill is posted. Add a barcode or SKU later under Products.
          </DialogDescription>
        </DialogHeader>
        {initialName !== null ? (
          <ProductForm initialName={initialName} units={units} gstRates={gstRates} onClose={onClose} onCreated={onCreated} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProductForm({
  initialName,
  units,
  gstRates,
  onClose,
  onCreated,
}: {
  initialName: string;
  units: UnitOption[];
  gstRates: GstRateOption[];
  onClose: () => void;
  onCreated: (product: PurchaseProductOption) => void;
}) {
  const { run, pending } = useAction();
  // New products can only use the rates in force today.
  const activeRates = gstRates.filter((r) => r.is_active);
  const form = useForm<QuickPurchaseProductInput>({
    resolver: zodResolver(quickPurchaseProductSchema),
    defaultValues: { name: initialName, unit_code: units[0]?.code ?? "PCS", gst_rate: "", hsn_code: "", sale_price: "" },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.stopPropagation();
        void form.handleSubmit(() =>
          run(() => createProductInlineAction(form.getValues()), {
            success: "Product created",
            onSuccess: (product) => {
              onCreated(product);
              onClose();
            },
            onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
          }),
        )(e);
      }}
    >
      <Field label="Product name" htmlFor="qp-name" required error={errors.name?.message}>
        <Input id="qp-name" autoFocus autoComplete="off" {...form.register("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unit" htmlFor="qp-unit" required error={errors.unit_code?.message}>
          <NativeSelect id="qp-unit" {...form.register("unit_code")}>
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name} ({u.code})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="GST rate" htmlFor="qp-gst" required error={errors.gst_rate?.message}>
          <NativeSelect id="qp-gst" {...form.register("gst_rate")}>
            <option value="">Select rate</option>
            {activeRates.map((r) => (
              <option key={r.rate} value={String(r.rate)}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="HSN code" htmlFor="qp-hsn" error={errors.hsn_code?.message} hint="4, 6 or 8 digits">
          <Input id="qp-hsn" inputMode="numeric" maxLength={8} autoComplete="off" className="tabular" {...form.register("hsn_code")} />
        </Field>
        <Field label="Selling price" htmlFor="qp-price" required error={errors.sale_price?.message} hint="What you sell it for, including GST">
          <MoneyInput id="qp-price" {...form.register("sale_price")} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>Create and add</SubmitButton>
      </DialogFooter>
    </form>
  );
}
