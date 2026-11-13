"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { renameDeviceAction, setDeviceActiveAction } from "@/app/app/(shell)/settings/actions";
import { runConfirm } from "./run-confirm";

export function DeviceActions({ device }: { device: { id: string; name: string; is_active: boolean } }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<string | undefined>();
  const { run, pending } = useAction();

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setName(device.name);
            setError(undefined);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            Rename
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename device</DialogTitle>
            <DialogDescription>A name your staff will recognise, like “Counter 1” or “Front tablet”.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return setError("Device name is required");
              run(() => renameDeviceAction({ id: device.id, name }), {
                success: "Device renamed",
                onSuccess: () => setOpen(false),
                onError: (message) => setError(message),
                silentError: true,
              });
            }}
          >
            <Field label="Device name" htmlFor={`device-${device.id}`} required error={error}>
              <Input
                id={`device-${device.id}`}
                autoFocus
                maxLength={60}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(undefined);
                }}
              />
            </Field>
            <DialogFooter>
              <SubmitButton pending={pending} disabled={pending || name.trim() === device.name}>
                Save name
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {device.is_active ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              Deactivate
            </Button>
          }
          title={`Deactivate ${device.name}?`}
          description="Do this when a tablet or computer is lost, sold or no longer used for billing. Bills from this device will be refused, including offline bills it has not yet sent, so let it finish syncing first if you still have it. Bills it already issued stay valid."
          confirmLabel="Deactivate"
          destructive
          onConfirm={() => runConfirm(() => setDeviceActiveAction({ id: device.id, is_active: false }), "Device deactivated")}
        />
      ) : (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              Reactivate
            </Button>
          }
          title={`Reactivate ${device.name}?`}
          description="The device can bill again and continues its own number series from where it stopped."
          confirmLabel="Reactivate"
          onConfirm={() => runConfirm(() => setDeviceActiveAction({ id: device.id, is_active: true }), "Device reactivated")}
        />
      )}
    </div>
  );
}
