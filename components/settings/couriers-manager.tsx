"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { courierSchema, type CourierInput } from "@/lib/validation/settings";
import { addCommonCouriersAction, deleteCourierAction, saveCourierAction } from "@/app/app/(shell)/settings/actions";
import { applyFieldErrors, runConfirm } from "./run-confirm";
import { CheckRow } from "./section";

export interface CourierRow {
  id: string;
  name: string;
  tracking_url_template: string | null;
  is_active: boolean;
}

function CourierDialog({ courier, onClose }: { courier: CourierRow | null; onClose: () => void }) {
  const { run, pending } = useAction();
  const form = useForm<CourierInput>({
    resolver: zodResolver(courierSchema),
    defaultValues: {
      id: courier?.id ?? "",
      name: courier?.name ?? "",
      tracking_url_template: courier?.tracking_url_template ?? "",
      is_active: courier?.is_active ?? true,
    },
  });
  const { errors } = form.formState;

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{courier ? "Edit courier" : "Add a courier"}</DialogTitle>
          <DialogDescription>Couriers you book parcels with. They appear in the list when you create a shipment.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) =>
            run(() => saveCourierAction(values), {
              success: courier ? "Courier saved" : "Courier added",
              onSuccess: onClose,
              onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
            }),
          )}
        >
          <Field label="Courier name" htmlFor="courier-name" required error={errors.name?.message}>
            <Input id="courier-name" autoFocus maxLength={80} {...form.register("name")} />
          </Field>
          <Field
            label="Tracking link"
            htmlFor="courier-url"
            error={errors.tracking_url_template?.message}
            hint={
              <>
                Optional. Open the courier&apos;s tracking page for one of your parcels, copy the address, and replace the
                tracking number in it with <span className="tabular font-medium text-foreground">{"{awb}"}</span>. Example:{" "}
                <span className="tabular">https://courier.example/track?no={"{awb}"}</span>
              </>
            }
          >
            <Input
              id="courier-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://…{awb}"
              {...form.register("tracking_url_template")}
            />
          </Field>
          <CheckRow title="Active" hint="Switched-off couriers are hidden when creating a shipment." {...form.register("is_active")} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>{courier ? "Save courier" : "Add courier"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Header buttons: add one courier, or add the well-known names in one tap. */
export function CourierToolbar({ missingCommon }: { missingCommon: string[] }) {
  const [adding, setAdding] = useState(false);
  const { run, pending } = useAction();

  return (
    <>
      {missingCommon.length > 0 ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={pending}>
              Add common couriers
            </Button>
          }
          title="Add common couriers?"
          description={
            <>
              This adds {missingCommon.join(", ")}. Only the names are added. Tracking links are left empty for you to fill in
              and check yourself, because they differ by service and change over time.
            </>
          }
          confirmLabel="Add them"
          onConfirm={() =>
            new Promise<boolean>((resolve) =>
              run(() => addCommonCouriersAction(), {
                success: (r) => (r.added === 0 ? "They were already in your list" : `Added ${r.added} ${r.added === 1 ? "courier" : "couriers"}`),
                onSuccess: () => resolve(true),
                onError: () => resolve(false),
              }),
            )
          }
        />
      ) : null}
      <Button onClick={() => setAdding(true)}>
        <Plus aria-hidden /> Add courier
      </Button>
      {adding ? <CourierDialog courier={null} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

export function CourierRowActions({ courier }: { courier: CourierRow }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button variant="outline" size="sm" onClick={() => setEditing(true)} aria-label={`Edit ${courier.name}`}>
        <Pencil aria-hidden /> Edit
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${courier.name}`} className="text-destructive hover:text-destructive">
            <Trash2 aria-hidden />
          </Button>
        }
        title={`Delete ${courier.name}?`}
        description="A courier that already has shipments cannot be deleted. Edit it and switch it off instead."
        confirmLabel="Delete"
        destructive
        onConfirm={() => runConfirm(() => deleteCourierAction({ id: courier.id }), "Courier deleted")}
      />
      {editing ? <CourierDialog courier={courier} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
