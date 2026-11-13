"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { NativeSelect } from "@/components/shared/field";

/** Outlet picker in the POS top bar. Switching starts a fresh bill for the other outlet, so it asks first. */
export function PosOutletSwitcher({
  outlets,
  activeId,
  switchOutlet,
}: {
  outlets: Array<{ id: string; name: string }>;
  activeId: string;
  switchOutlet: (outletId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const targetName = outlets.find((o) => o.id === target)?.name ?? "";

  function confirm() {
    if (!target) return;
    startTransition(async () => {
      try {
        const result = await switchOutlet(target);
        if (!result.ok) {
          toast.error(result.error ?? "Could not switch outlet");
          return;
        }
        setTarget(null);
        router.refresh();
      } catch {
        toast.error("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <>
      <NativeSelect
        aria-label="Outlet"
        value={activeId}
        disabled={pending}
        onChange={(e) => e.target.value !== activeId && setTarget(e.target.value)}
        className="h-7 w-auto max-w-40 font-medium sm:max-w-56"
      >
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </NativeSelect>
      <AlertDialog open={target !== null} onOpenChange={(open) => !open && !pending && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {targetName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The bill on this screen will be cleared. Hold it first if you want to come back to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Stay here</AlertDialogCancel>
            <Button onClick={confirm} disabled={pending}>
              Switch outlet
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
