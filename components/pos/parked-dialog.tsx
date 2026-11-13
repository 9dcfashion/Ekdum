"use client";

import { useEffect, useState } from "react";
import { Clock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import type { ParkedBill, ParkedStore } from "@/lib/pos/types";

function ParkedList({
  store,
  currentBillInUse,
  onResume,
  onChanged,
}: {
  store: ParkedStore;
  currentBillInUse: boolean;
  onResume: (bill: ParkedBill) => void;
  onChanged: () => void;
}) {
  const [bills, setBills] = useState<ParkedBill[] | null>(null);
  /** Which row is asking "are you sure?", and for what. */
  const [asking, setAsking] = useState<{ id: string; action: "resume" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store.list().then(
      (list) => !cancelled && setBills(list),
      () => !cancelled && setBills([]),
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  async function remove(bill: ParkedBill) {
    setBusy(true);
    try {
      await store.remove(bill.id);
      setBills((bills ?? []).filter((b) => b.id !== bill.id));
      onChanged();
    } catch {
      toast.error("Could not delete the held bill");
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  if (bills === null) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Loading held bills" />
      </div>
    );
  }
  if (bills.length === 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
        <p className="font-medium">No held bills</p>
        <p className="max-w-xs text-sm text-muted-foreground">Use Hold when a customer steps away, then carry on with the next one.</p>
      </div>
    );
  }

  return (
    <ul className="grid max-h-[60dvh] gap-2 overflow-y-auto">
      {bills.map((bill) => {
        const confirm = asking?.id === bill.id ? asking.action : null;
        return (
          <li key={bill.id} className="rounded-lg border p-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{bill.customerLabel}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Clock className="size-3 shrink-0" aria-hidden />
                  {formatDateTime(bill.parkedAt)} · {bill.itemCount} {bill.itemCount === 1 ? "item" : "items"}
                </p>
              </div>
              <p className="tabular shrink-0 text-sm font-semibold">{formatINR(bill.totalPaise)}</p>
            </div>
            {confirm ? (
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2" role="alert">
                <p className="mr-auto text-sm">
                  {confirm === "delete" ? "Delete this held bill for good?" : "This replaces the bill on screen. Continue?"}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setAsking(null)} disabled={busy}>
                  No
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={confirm === "delete" ? "destructive" : "default"}
                  disabled={busy}
                  autoFocus
                  onClick={() => (confirm === "delete" ? void remove(bill) : onResume(bill))}
                >
                  {confirm === "delete" ? "Delete" : "Replace and resume"}
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete held bill of ${bill.customerLabel}`}
                  onClick={() => setAsking({ id: bill.id, action: "delete" })}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
                <Button type="button" size="sm" onClick={() => (currentBillInUse ? setAsking({ id: bill.id, action: "resume" }) : onResume(bill))}>
                  Resume
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Held bills: time, customer and total, with resume and delete. */
export function ParkedDialog({
  open,
  onOpenChange,
  onClosed,
  ...list
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  store: ParkedStore;
  currentBillInUse: boolean;
  onResume: (bill: ParkedBill) => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>Held bills</DialogTitle>
          <DialogDescription>Saved on this device only.</DialogDescription>
        </DialogHeader>
        {open ? <ParkedList {...list} /> : null}
      </DialogContent>
    </Dialog>
  );
}
