"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/shared/field";
import { Textarea } from "@/components/ui/textarea";
import {
  needsConfirmation,
  nextStatuses,
  otherStatuses,
  shipmentStatusLabel,
  type ShipmentStatusKey,
} from "@/lib/shipments";
import { updateShipmentStatusAction } from "@/app/app/(shell)/shipments/actions";

const BUTTON_TEXT: Record<ShipmentStatusKey, string> = {
  booked: "Back to booked",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
  rto: "RTO (returned)",
  cancelled: "Cancel shipment",
};

const CONFIRM_TEXT: Partial<Record<ShipmentStatusKey, string>> = {
  cancelled: "The shipment will be marked as cancelled. Do this only if the parcel was never sent.",
  rto: "The shipment will be marked as returned to you (RTO).",
};

/** Big buttons for the likely next step, a "More" menu for corrections, and an optional note. */
export function StatusActions({ shipmentId, status }: { shipmentId: string; status: string }) {
  const [note, setNote] = useState("");
  const [confirmFor, setConfirmFor] = useState<ShipmentStatusKey | null>(null);
  const [pending, startTransition] = useTransition();
  const next = nextStatuses(status);
  const others = otherStatuses(status);

  function apply(target: ShipmentStatusKey) {
    startTransition(async () => {
      try {
        const result = await updateShipmentStatusAction({ id: shipmentId, status: target, note });
        if (result.ok) {
          toast.success(`Marked as ${shipmentStatusLabel(target)}`);
          setNote("");
          setConfirmFor(null);
        } else {
          toast.error(result.error);
        }
      } catch {
        toast.error("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  function choose(target: ShipmentStatusKey) {
    if (needsConfirmation(status, target)) setConfirmFor(target);
    else apply(target);
  }

  return (
    <div className="grid gap-3">
      <Field label="Note for this update" htmlFor="status_note" hint="Optional. Shown in the timeline.">
        <Textarea
          id="status_note"
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Handed to the pickup boy"
          disabled={pending}
        />
      </Field>

      {next.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {next.map((target, index) => (
            <Button
              key={target}
              type="button"
              variant={target === "cancelled" || target === "rto" ? "destructive" : index === 0 ? "default" : "outline"}
              className={`h-14 text-base whitespace-normal md:h-10 md:text-sm ${next.length % 2 === 1 && index === 0 ? "col-span-2" : ""}`}
              disabled={pending}
              onClick={() => choose(target)}
            >
              {pending && !confirmFor ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {BUTTON_TEXT[target]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          This shipment is finished. If the status is wrong, correct it from the menu below.
        </p>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="h-11 md:h-8" disabled={pending}>
            {next.length > 0 ? "More" : "Correct status"} <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Change status to</DropdownMenuLabel>
          {others.map((target) => (
            <DropdownMenuItem
              key={target}
              className="min-h-10"
              variant={target === "cancelled" || target === "rto" ? "destructive" : "default"}
              onSelect={() => choose(target)}
            >
              {shipmentStatusLabel(target)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmFor !== null} onOpenChange={(open) => !open && !pending && setConfirmFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmFor ? `Mark as ${shipmentStatusLabel(confirmFor)}?` : "Change status?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(confirmFor && CONFIRM_TEXT[confirmFor]) ||
                `This corrects the status from ${shipmentStatusLabel(status)}. The change is recorded in the timeline.`}
              {note.trim() ? ` Your note will be saved with it.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Go back</AlertDialogCancel>
            <Button
              type="button"
              variant={confirmFor === "cancelled" || confirmFor === "rto" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => confirmFor && apply(confirmFor)}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Yes, update
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
