"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Printer, RotateCw, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/dates";
import { compareNumbers, peekNumber } from "@/lib/offline/numbering";
import { getOfflineRepo } from "@/lib/offline/db";
import { discardBill, reissueBill, retryBill } from "@/lib/offline/queue";
import type { DeviceRecord, QueueRow, QueueStatus } from "@/lib/offline/types";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { OfflineReceiptDialog } from "./offline-receipt";

const STATUS: Record<QueueStatus, { label: string; className: string }> = {
  pending: { label: "Waiting to sync", className: "border-amber-200 bg-amber-50 text-amber-800" },
  syncing: { label: "Sending", className: "border-sky-200 bg-sky-50 text-sky-700" },
  synced: { label: "Synced", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  conflict: { label: "Not accepted", className: "border-red-200 bg-red-50 text-red-700" },
  failed: { label: "Keeps failing", className: "border-red-200 bg-red-50 text-red-700" },
};

const SYNCED_SHOWN = 15;

type Ask = { kind: "discard" | "reissue"; row: QueueRow } | null;

/** The list inside "Pending and conflicts": every bill kept on this device, with what can be done about it. */
export function PendingBills({
  businessId,
  rows,
  device,
  canDiscard,
  onChanged,
}: {
  businessId: string;
  rows: QueueRow[];
  /** This outlet's active registration (for previewing the next number). */
  device: DeviceRecord | null;
  /** Owners and managers only (sales.cancel). */
  canDiscard: boolean;
  onChanged: () => void;
}) {
  const [receipt, setReceipt] = useState<QueueRow | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const byNumber = (a: QueueRow, b: QueueRow) => compareNumbers(a.number, b.number);
  const attention = rows.filter((r) => r.status === "conflict" || r.status === "failed").sort(byNumber);
  const waiting = rows.filter((r) => r.status === "pending" || r.status === "syncing").sort(byNumber);
  const synced = rows
    .filter((r) => r.status === "synced")
    .sort((a, b) => (b.syncedAt ?? 0) - (a.syncedAt ?? 0))
    .slice(0, SYNCED_SHOWN);

  async function act(action: () => Promise<unknown>, done: string) {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const repo = () => {
    const r = getOfflineRepo(businessId);
    if (!r) throw new Error("This browser cannot open the saved bills");
    return r;
  };

  async function retry(row: QueueRow) {
    if (await act(() => retryBill(repo(), row.clientUuid), `Bill ${row.number} will be sent again`)) onChanged();
  }

  async function confirmAsk() {
    if (!ask) return;
    const { row } = ask;
    if (ask.kind === "discard") {
      if (await act(() => discardBill(repo(), row.clientUuid, typed), `Bill ${row.number} was discarded`)) setAsk(null);
      return;
    }
    let next: QueueRow | null = null;
    const ok = await act(async () => {
      next = await reissueBill(repo(), row.clientUuid);
    }, "The bill has a new number. Print it again for the customer.");
    if (ok) {
      setAsk(null);
      if (next) setReceipt(next);
      onChanged();
    }
  }

  let reissuePreview: string | null = null;
  if (ask?.kind === "reissue" && device && ask.row.outletId === device.outletId && ask.row.input.invoice_date) {
    try {
      reissuePreview = peekNumber(device.prefix, device.counters ?? {}, ask.row.input.invoice_date).number;
    } catch {
      reissuePreview = null;
    }
  }

  const renderRow = (row: QueueRow) => {
    const status = STATUS[row.status];
    const stuck = row.status === "conflict" || row.status === "failed";
    return (
      <li key={row.clientUuid} className="grid gap-2 border-b p-3 last:border-b-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="tabular font-semibold">{row.number}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatDateTime(new Date(row.createdAt))} · {row.customerLabel}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tabular font-semibold">{formatINR(row.totalPaise)}</p>
            <span className={cn("mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.7rem] font-medium", status.className)}>
              {row.status === "syncing" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : row.status === "synced" ? (
                <CheckCircle2 className="size-3" aria-hidden />
              ) : stuck ? (
                <AlertTriangle className="size-3" aria-hidden />
              ) : (
                <Clock className="size-3" aria-hidden />
              )}
              {status.label}
            </span>
          </div>
        </div>

        {row.reissuedFrom ? (
          <p className="text-xs text-muted-foreground">
            First printed as <span className="tabular">{row.reissuedFrom}</span>
          </p>
        ) : null}
        {row.status !== "synced" && row.lastError ? (
          <p className={cn("text-sm", stuck ? "text-destructive" : "text-muted-foreground")} role={stuck ? "alert" : undefined}>
            {row.lastError}
            {row.attempts > 0 ? <span className="text-muted-foreground"> · tried {row.attempts} {row.attempts === 1 ? "time" : "times"}</span> : null}
          </p>
        ) : null}
        {row.status === "synced" && row.warnings.length > 0 ? (
          <ul className="grid gap-0.5 text-xs text-amber-800">
            {row.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="sm" onClick={() => setReceipt(row)}>
            <Printer aria-hidden /> View / print
          </Button>
          {row.status === "synced" && row.invoiceId ? (
            <Button variant="outline" size="sm" asChild>
              <a href={`/app/sales/${row.invoiceId}`}>
                <ExternalLink aria-hidden /> Open in Sales
              </a>
            </Button>
          ) : null}
          {stuck ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void retry(row)}>
              <RotateCw aria-hidden /> Retry
            </Button>
          ) : null}
          {row.status === "conflict" && row.lastCode === "number_conflict" ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setAsk({ kind: "reissue", row })}>
              Re-issue with a new number
            </Button>
          ) : null}
          {stuck && canDiscard ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => {
                setTyped("");
                setAsk({ kind: "discard", row });
              }}
            >
              <Trash2 aria-hidden /> Discard
            </Button>
          ) : null}
        </div>
        {stuck && !canDiscard ? <p className="text-xs text-muted-foreground">Only an owner or manager can discard a bill.</p> : null}
      </li>
    );
  };

  const section = (title: string, list: QueueRow[], note?: string) =>
    list.length > 0 ? (
      <section aria-label={title}>
        <h3 className="border-y bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {title} ({list.length}){note ? ` · ${note}` : ""}
        </h3>
        <ul>{list.map(renderRow)}</ul>
      </section>
    ) : null;

  return (
    <>
      {rows.length === 0 ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">No bills are waiting on this device. Bills made offline will show up here.</p>
      ) : (
        <>
          {section("Needs your attention", attention, "kept until you decide")}
          {section("Waiting to sync", waiting)}
          {section("Synced", synced, "kept for 7 days")}
        </>
      )}

      <OfflineReceiptDialog row={receipt} onClose={() => setReceipt(null)} />

      <AlertDialog open={ask !== null} onOpenChange={(next) => !next && !busy && setAsk(null)}>
        <AlertDialogContent>
          {ask?.kind === "discard" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard bill {ask.row.number}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="grid gap-2 text-sm text-muted-foreground">
                    <p>
                      The customer already has a printed bill for <span className="tabular font-medium text-foreground">{formatINR(ask.row.totalPaise)}</span>. If you
                      discard it, that bill will have no record anywhere: no sale, no stock change, no tax entry. This cannot be undone.
                    </p>
                    <p>Do this only if the sale did not happen or you have entered it again by hand. Type the bill number to confirm.</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                aria-label="Type the bill number to confirm"
                placeholder={ask.row.number}
                autoComplete="off"
                autoCapitalize="characters"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="tabular"
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Keep the bill</AlertDialogCancel>
                <Button variant="destructive" disabled={busy || typed.trim().toUpperCase() !== ask.row.number} onClick={() => void confirmAsk()}>
                  Discard for good
                </Button>
              </AlertDialogFooter>
            </>
          ) : ask?.kind === "reissue" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Give this bill a new number?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="grid gap-2 text-sm text-muted-foreground">
                    <p>
                      The number <span className="tabular font-medium text-foreground">{ask.row.number}</span> is already used by another bill on the server.
                    </p>
                    <p>
                      This bill will become{" "}
                      <span className="tabular font-medium text-foreground">{reissuePreview ?? "the next number of this device"}</span> and will be sent again. The copy
                      the customer has shows the old number: print the bill again, hand over the new copy and destroy the old one.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                <Button disabled={busy} onClick={() => void confirmAsk()}>
                  Re-issue and reprint
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
