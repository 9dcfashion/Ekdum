"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Store } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { Field } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { StatusBadge } from "@/components/shared/status-badge";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { validateSeriesPrefix } from "@/lib/gst/numbering";
import { stateName } from "@/lib/gst/states";
import { creditNotePrefixFor, sampleNumber, suggestInvoicePrefix } from "@/lib/settings/series";
import { useAction } from "@/lib/use-action";
import { outletSchema, type OutletInput } from "@/lib/validation/onboarding";
import { addOutletAction, updateOutletAction } from "@/app/app/(shell)/settings/actions";
import { applyFieldErrors } from "./run-confirm";
import { CheckRow } from "./section";

export interface OutletRow {
  id: string;
  name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  state_code: string;
  gstin: string | null;
  phone: string | null;
  is_active: boolean;
  /** Prefix of the active invoice series for this financial year, when there is one. */
  invoicePrefix: string | null;
}

interface BusinessDefaults {
  registered: boolean;
  gstin: string | null;
  state_code: string;
  city: string | null;
  phone: string | null;
}

function OutletDialog({
  outlet,
  business,
  usedPrefixes,
  fy,
  isOnlyActive,
  onClose,
}: {
  /** Null → adding a new outlet. */
  outlet: OutletRow | null;
  business: BusinessDefaults;
  usedPrefixes: string[];
  fy: string;
  isOnlyActive: boolean;
  onClose: () => void;
}) {
  const { run, pending } = useAction();
  const [ownGstin, setOwnGstin] = useState(!!outlet?.gstin);
  const [isActive, setIsActive] = useState(outlet?.is_active ?? true);
  const [prefix, setPrefix] = useState(() => suggestInvoicePrefix(usedPrefixes));
  const [prefixError, setPrefixError] = useState<string | null>(null);
  const form = useForm<OutletInput>({
    resolver: zodResolver(outletSchema),
    defaultValues: {
      name: outlet?.name ?? "",
      address_line1: outlet?.address_line1 ?? "",
      address_line2: outlet?.address_line2 ?? "",
      city: outlet?.city ?? business.city ?? "",
      pincode: outlet?.pincode ?? "",
      state_code: outlet?.state_code ?? business.state_code,
      phone: outlet?.phone ?? business.phone ?? "",
      gstin: outlet?.gstin ?? "",
    },
  });
  const { errors } = form.formState;

  const cleanPrefix = prefix.trim().toUpperCase();
  const liveError =
    validateSeriesPrefix(cleanPrefix) ?? (usedPrefixes.includes(cleanPrefix) ? `${cleanPrefix} is already used by another series` : null);
  const creditPrefix = liveError ? null : creditNotePrefixFor(cleanPrefix, usedPrefixes);
  const sample = liveError ? null : sampleNumber(cleanPrefix, fy, 1);

  function submit(values: OutletInput) {
    const payload = ownGstin && business.registered ? values : { ...values, gstin: "" };
    if (outlet) {
      run(() => updateOutletAction({ id: outlet.id, outlet: payload, is_active: isActive }), {
        success: "Outlet saved",
        onSuccess: onClose,
        onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors, "outlet."),
      });
      return;
    }
    if (liveError) {
      setPrefixError(liveError);
      return;
    }
    run(() => addOutletAction({ outlet: payload, invoice_prefix: cleanPrefix }), {
      onSuccess: (created) => {
        toast.success(
          created.canSeeIt
            ? `Outlet added. Bills there will start at ${created.invoicePrefix}/${fy}/00001.`
            : "Outlet added. Ask an owner to give you access to it under Staff.",
        );
        onClose();
      },
      onError: (_e, fieldErrors) => {
        applyFieldErrors(form.setError, fieldErrors, "outlet.");
        if (fieldErrors?.invoice_prefix?.[0]) setPrefixError(fieldErrors.invoice_prefix[0]);
      },
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{outlet ? "Edit outlet" : "Add an outlet"}</DialogTitle>
          <DialogDescription>
            {outlet
              ? "Changes apply to bills made from now on."
              : "A shop, branch or godown that bills and keeps its own stock. It gets its own bill numbers."}
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Outlet name" htmlFor="outlet-name" required error={errors.name?.message} hint="e.g. Main Shop, Andheri Branch">
              <Input id="outlet-name" autoFocus {...form.register("name")} />
            </Field>
            <Field label="Phone" htmlFor="outlet-phone" error={errors.phone?.message}>
              <Input id="outlet-phone" type="tel" {...form.register("phone")} />
            </Field>
            <Field label="Address line 1" htmlFor="outlet-address1" error={errors.address_line1?.message} className="sm:col-span-2">
              <Input id="outlet-address1" {...form.register("address_line1")} />
            </Field>
            <Field label="Address line 2" htmlFor="outlet-address2" error={errors.address_line2?.message} className="sm:col-span-2">
              <Input id="outlet-address2" {...form.register("address_line2")} />
            </Field>
            <Field label="City" htmlFor="outlet-city" error={errors.city?.message}>
              <Input id="outlet-city" {...form.register("city")} />
            </Field>
            <Field label="PIN code" htmlFor="outlet-pincode" error={errors.pincode?.message}>
              <Input id="outlet-pincode" inputMode="numeric" maxLength={6} {...form.register("pincode")} />
            </Field>
            <Field label="State" htmlFor="outlet-state" required error={errors.state_code?.message} className="sm:col-span-2">
              <StateSelect id="outlet-state" {...form.register("state_code")} />
            </Field>
          </div>

          {business.registered ? (
            <div>
              <CheckRow
                title="This outlet has its own GSTIN"
                hint={
                  <>
                    Only needed when the outlet is in a different state from the business. Otherwise bills use{" "}
                    <span className="tabular">{business.gstin}</span>.
                  </>
                }
                checked={ownGstin}
                onChange={(e) => setOwnGstin(e.target.checked)}
              />
              {ownGstin ? (
                <Field label="Outlet GSTIN" htmlFor="outlet-gstin" error={errors.gstin?.message} className="mt-3 max-w-xs" hint="Must belong to the outlet's state.">
                  <Input id="outlet-gstin" maxLength={15} className="uppercase tabular" {...form.register("gstin")} />
                </Field>
              ) : null}
            </div>
          ) : null}

          {outlet ? (
            <CheckRow
              title="Active"
              hint={
                isOnlyActive
                  ? "This is your only active outlet, so it cannot be switched off."
                  : "Switch off an outlet you no longer use. Its bills and stock history stay. Nobody can bill there while it is off."
              }
              checked={isActive}
              disabled={isOnlyActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          ) : (
            <div className="rounded-xl border bg-muted/30 p-3">
              <Field
                label="Bill number prefix"
                htmlFor="outlet-prefix"
                required
                error={prefixError ?? (prefix && liveError ? liveError : undefined)}
                hint="Up to 4 letters or digits, different from every other series."
              >
                <Input
                  id="outlet-prefix"
                  maxLength={4}
                  className="max-w-28 uppercase tabular"
                  value={prefix}
                  onChange={(e) => {
                    setPrefix(e.target.value);
                    setPrefixError(null);
                  }}
                />
              </Field>
              <p className="mt-2 text-xs text-muted-foreground">
                {sample ? (
                  <>
                    First bill: <span className="tabular font-medium text-foreground">{sample}</span>
                    {creditPrefix ? (
                      <>
                        {" "}
                        · First credit note: <span className="tabular font-medium text-foreground">{sampleNumber(creditPrefix, fy, 1)}</span>
                      </>
                    ) : null}
                    . Both series are created for you with the outlet.
                  </>
                ) : (
                  "An invoice series and a credit-note series are created for you with the outlet."
                )}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>{outlet ? "Save outlet" : "Add outlet"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OutletsManager({
  outlets,
  business,
  usedPrefixes,
  fy,
}: {
  outlets: OutletRow[];
  business: BusinessDefaults;
  usedPrefixes: string[];
  fy: string;
}) {
  // undefined → closed, null → adding, row → editing
  const [editing, setEditing] = useState<OutletRow | null | undefined>(undefined);
  const activeCount = outlets.filter((o) => o.is_active).length;

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing(null)}>
          <Plus aria-hidden /> Add outlet
        </Button>
      </div>

      {outlets.length === 0 ? (
        <EmptyState
          icon={Store}
          title="No outlets you can see"
          description="Add an outlet to start billing there."
          action={
            <Button onClick={() => setEditing(null)}>
              <Plus aria-hidden /> Add outlet
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {outlets.map((o) => {
            const address = [o.address_line1, o.address_line2, o.city, o.pincode].filter(Boolean).join(", ");
            return (
              <li key={o.id} className="flex items-start justify-between gap-3 rounded-xl border p-3 text-sm">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{o.name}</span>
                    <StatusBadge status={o.is_active ? "active" : "inactive"} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{address || "No address"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {stateName(o.state_code)}
                    {o.phone ? ` · ${o.phone}` : ""}
                  </p>
                  <p className="tabular mt-0.5 text-xs text-muted-foreground">
                    {o.gstin ? `Own GSTIN ${o.gstin}` : business.registered ? "Uses the business GSTIN" : "No GSTIN"}
                    {o.invoicePrefix ? ` · Bills ${o.invoicePrefix}/${fy}/…` : o.is_active ? " · No active invoice series" : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing(o)} aria-label={`Edit ${o.name}`}>
                  <Pencil aria-hidden /> Edit
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {editing !== undefined ? (
        <OutletDialog
          key={editing?.id ?? "new"}
          outlet={editing}
          business={business}
          usedPrefixes={usedPrefixes}
          fy={fy}
          isOnlyActive={!!editing && editing.is_active && activeCount <= 1}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </>
  );
}
