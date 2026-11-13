"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil } from "lucide-react";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/lib/use-action";
import { shipmentDetailsSchema, type ShipmentDetailsInput } from "@/lib/validation/shipments";
import { updateShipmentDetailsAction } from "@/app/app/(shell)/shipments/actions";

export function EditDetails({
  shipmentId,
  couriers,
  values,
}: {
  shipmentId: string;
  /** Active partners, plus the current one even if it has been switched off. */
  couriers: Array<{ id: string; name: string; is_active: boolean }>;
  values: { courier_partner_id: string | null; tracking_number: string | null; notes: string | null };
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const defaults: ShipmentDetailsInput = {
    id: shipmentId,
    courier_partner_id: values.courier_partner_id ?? "",
    tracking_number: values.tracking_number ?? "",
    notes: values.notes ?? "",
  };
  const form = useForm<ShipmentDetailsInput>({ resolver: zodResolver(shipmentDetailsSchema), defaultValues: defaults });
  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) form.reset(defaults);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 md:h-8">
          <Pencil aria-hidden /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit shipment</DialogTitle>
          <DialogDescription>Fix the courier, the tracking number or the notes.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(() =>
            run(() => updateShipmentDetailsAction(form.getValues()), {
              success: "Shipment updated",
              onSuccess: () => setOpen(false),
              onError: (_error, fieldErrors) => {
                for (const name of ["courier_partner_id", "tracking_number", "notes"] as const) {
                  const message = fieldErrors?.[name]?.[0];
                  if (message) form.setError(name, { message });
                }
              },
            }),
          )}
        >
          <Field label="Courier partner" htmlFor="edit_courier" error={errors.courier_partner_id?.message}>
            <NativeSelect id="edit_courier" className="h-11 md:h-8" {...form.register("courier_partner_id")}>
              <option value="">No courier partner</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? "" : " (inactive)"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Tracking number" htmlFor="edit_tracking" error={errors.tracking_number?.message}>
            <Input
              id="edit_tracking"
              className="tabular h-11 md:h-8"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              {...form.register("tracking_number")}
            />
          </Field>
          <Field label="Notes" htmlFor="edit_notes" error={errors.notes?.message}>
            <Textarea id="edit_notes" rows={3} {...form.register("notes")} />
          </Field>
          <SubmitButton pending={pending} pendingText="Saving" size="lg" className="h-12 md:h-9">
            Save changes
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
