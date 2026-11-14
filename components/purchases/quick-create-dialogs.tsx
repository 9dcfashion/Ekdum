"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createProductInlineAction, createVendorInlineAction } from "@/app/app/(shell)/purchases/actions";
import { normaliseGstin, stateName, validateGstin } from "@/lib/gst";
import type { GstRateOption, PurchaseProductOption, UnitOption, VendorOption } from "@/lib/purchases/types";
import { useAction } from "@/lib/use-action";
import {
  quickPurchaseProductSchema,
  quickVendorSchema,
  type QuickPurchaseProductInput,
  type QuickVendorInput,
} from "@/lib/validation/purchases";
import { applyFieldErrors } from "./form-helpers";

const big = "h-12 text-base lg:h-10";
const dialogClass = "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md";

/** "New supplier" for the purchase entry. `initialName` is the typed name, or null when closed. */
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
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className="text-lg">New supplier</DialogTitle>
          <DialogDescription>Just the name is enough. Add the address and other details later under Vendors.</DialogDescription>
        </DialogHeader>
        {initialName !== null ? <VendorForm initialName={initialName} onClose={onClose} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Feedback while the GSTIN is typed: count, then valid (with the state) or what is wrong. */
function gstinFeedback(raw: string | null | undefined): { tone: "muted" | "ok" | "bad"; text: string } {
  const gstin = normaliseGstin(raw);
  if (!gstin) return { tone: "muted", text: "Leave it empty if the supplier has no GSTIN." };
  if (gstin.length < 15) return { tone: "muted", text: `${gstin.length} of 15 characters` };
  const parsed = validateGstin(gstin);
  return parsed.valid
    ? { tone: "ok", text: `Looks right. Registered in ${stateName(parsed.stateCode)}.` }
    : { tone: "bad", text: parsed.message ?? "This GSTIN is not valid" };
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
  const feedback = gstinFeedback(gstin);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.stopPropagation();
        void form.handleSubmit(() =>
          run(() => createVendorInlineAction(form.getValues()), {
            success: "Supplier added",
            onSuccess: (vendor) => {
              onCreated(vendor);
              onClose();
            },
            onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
          }),
        )(e);
      }}
    >
      <Field label="Supplier name" htmlFor="qv-name" required error={errors.name?.message}>
        <Input id="qv-name" autoFocus autoComplete="off" className={big} {...form.register("name")} />
      </Field>
      <Field label="Mobile (optional)" htmlFor="qv-phone" error={errors.phone?.message}>
        <Input id="qv-phone" type="tel" inputMode="tel" autoComplete="off" className={big} {...form.register("phone")} />
      </Field>
      <div className="grid gap-1.5">
        <Field label="GSTIN (optional)" htmlFor="qv-gstin" error={errors.gstin?.message}>
          <Input
            id="qv-gstin"
            maxLength={15}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={`tabular uppercase ${big}`}
            aria-invalid={feedback.tone === "bad" || !!errors.gstin || undefined}
            aria-describedby="qv-gstin-feedback"
            {...form.register("gstin")}
          />
        </Field>
        {errors.gstin ? null : (
          <p
            id="qv-gstin-feedback"
            aria-live="polite"
            className={
              feedback.tone === "ok" ? "flex items-center gap-1 text-sm text-emerald-700" : feedback.tone === "bad" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
            }
          >
            {feedback.tone === "ok" ? <CheckCircle2 className="size-4" aria-hidden /> : null}
            {feedback.text}
          </p>
        )}
      </div>
      {parsed.valid ? null : (
        <Field label="State (optional)" htmlFor="qv-state" error={errors.state_code?.message} hint="Where the supplier is. It decides CGST + SGST or IGST.">
          <StateSelect id="qv-state" className={big} {...form.register("state_code")} />
        </Field>
      )}
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-12 lg:h-9" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending} className="h-12 lg:h-9">
          Add supplier
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** "New item" for the purchase entry. `initialName` is null when closed. */
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
      <DialogContent className={dialogClass}>
        <DialogHeader>
          <DialogTitle className="text-lg">New item</DialogTitle>
          <DialogDescription>
            It is added to your item list and to this bill. Stock goes up when the bill is added to stock. Add a barcode later under Products.
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
            success: "Item added",
            onSuccess: (product) => {
              onCreated(product);
              onClose();
            },
            onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
          }),
        )(e);
      }}
    >
      <Field label="Item name" htmlFor="qp-name" required error={errors.name?.message}>
        <Input id="qp-name" autoFocus autoComplete="off" className={big} {...form.register("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unit" htmlFor="qp-unit" required error={errors.unit_code?.message}>
          <NativeSelect id="qp-unit" className={big} {...form.register("unit_code")}>
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name} ({u.code})
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="GST rate" htmlFor="qp-gst" required error={errors.gst_rate?.message}>
          <NativeSelect id="qp-gst" className={big} {...form.register("gst_rate")}>
            <option value="">Select rate</option>
            {activeRates.map((r) => (
              <option key={r.rate} value={String(r.rate)}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Selling price" htmlFor="qp-price" required error={errors.sale_price?.message} hint="What you sell it for, with GST">
          <MoneyInput id="qp-price" className={big} {...form.register("sale_price")} />
        </Field>
        <Field label="HSN code (optional)" htmlFor="qp-hsn" error={errors.hsn_code?.message} hint="4, 6 or 8 digits">
          <Input id="qp-hsn" inputMode="numeric" maxLength={8} autoComplete="off" className={`tabular ${big}`} {...form.register("hsn_code")} />
        </Field>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-12 lg:h-9" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending} className="h-12 lg:h-9">
          Add item
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
