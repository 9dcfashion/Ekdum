"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CloudUpload, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { deviceSeriesAction } from "@/app/app/pos/actions";
import { istDateString } from "@/lib/dates";
import { describeAge } from "@/lib/offline/age";
import { getOfflineRepo, requestPersistentStorage } from "@/lib/offline/db";
import { peekNumber, reconcileCounters } from "@/lib/offline/numbering";
import { countQueue } from "@/lib/offline/queue";
import { createFetchSender, runSync, SYNC_INTERVAL_MS, withSyncLock, type SyncState } from "@/lib/offline/sync";
import { cn } from "@/lib/utils";
import { PendingBills } from "./pending-bills";
import { useCatalogMeta, useDevice, useLastSync, useNow, useOnline, useQueueRows } from "./use-offline";

/**
 * The connection and sync status in the POS top bar, and the engine that sends
 * queued bills: on load, when the connection returns, every minute while
 * anything is waiting, and on demand. Opens the "Pending and conflicts" panel.
 */
export function PosStatus({ businessId, outletId, canDiscard }: { businessId: string; outletId: string | null; canDiscard: boolean }) {
  const online = useOnline();
  const now = useNow();
  const rows = useQueueRows(businessId);
  const device = useDevice(businessId, outletId ?? "");
  const catalogMeta = useCatalogMeta(businessId, outletId ?? "");
  const lastSync = useLastSync(businessId);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<SyncState | null>(null);
  const runningRef = useRef(false);

  const counts = countQueue(rows);
  const needsSignIn = state === "auth";

  async function sync(force: boolean, announce = false) {
    // Yield first: this is also called from effects, and state must not change while one is running.
    await Promise.resolve();
    const repo = getOfflineRepo(businessId);
    if (!repo || runningRef.current) return;
    if (!navigator.onLine) {
      if (announce) toast.error("You are offline. Bills will sync when the connection is back.");
      return;
    }
    runningRef.current = true;
    setRunning(true);
    try {
      const summary = await withSyncLock(repo, businessId, () => runSync({ repo, send: createFetchSender(businessId), now: Date.now }, { force }));
      if (!summary) {
        if (announce) toast.message("Another tab is already syncing.");
        return;
      }
      setState(summary.state);
      if (summary.conflicts > 0) {
        toast.error(`${summary.conflicts} ${summary.conflicts === 1 ? "bill needs" : "bills need"} your attention`, {
          description: "The server did not accept it. Open Pending bills to see why.",
          action: { label: "Open", onClick: () => setOpen(true) },
        });
      }
      if (summary.state === "auth") toast.error("Sign in again to sync your bills. They are safe on this device.");
      else if (summary.state === "business_mismatch") toast.error("These bills belong to another business. Switch back to it to sync them.");
      else if (announce) {
        if (summary.state === "unreachable") toast.error(summary.reason ?? "Could not reach the server. Will try again.");
        else if (summary.synced > 0) toast.success(`${summary.synced} ${summary.synced === 1 ? "bill" : "bills"} synced`);
        else if (summary.conflicts === 0) toast.message(summary.retried > 0 ? "Some bills will be tried again shortly." : "Everything is already synced.");
      }
    } catch {
      if (announce) toast.error("Sync could not run on this device. Try again.");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  /** Raise the local counter to the server's, and notice a device that was deactivated. */
  async function reconcile() {
    await Promise.resolve();
    const repo = getOfflineRepo(businessId);
    if (!repo || !outletId || !navigator.onLine) return;
    const local = await repo.getDevice(outletId).catch(() => undefined);
    if (!local) return;
    void requestPersistentStorage();
    try {
      const result = await deviceSeriesAction({ device_id: local.deviceId });
      if (!result.ok) return;
      const { found, active, series } = result.data;
      await repo.updateDevice(outletId, (d) => ({
        ...d,
        counters: reconcileCounters(d.counters ?? {}, series),
        // Only a clear "deactivated" answer switches the device off; "not visible to this user" does not.
        revoked: found ? !active : d.revoked,
      }));
    } catch {
      // Offline after all: the local counter is still safe to use.
    }
  }

  const onWake = useEffectEvent((force: boolean) => {
    void reconcile();
    void sync(force);
  });

  // On POS load and whenever the connection returns.
  useEffect(() => {
    const kick = setTimeout(() => onWake(false), 0);
    const onOnline = () => onWake(true);
    window.addEventListener("online", onOnline);
    return () => {
      clearTimeout(kick);
      window.removeEventListener("online", onOnline);
    };
  }, [businessId, outletId]);

  // Every minute while anything is waiting.
  const waiting = counts.pending > 0;
  const onTick = useEffectEvent(() => void sync(false));
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => onTick(), SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  const activeDevice = device && !device.revoked ? device : null;
  let nextNumber: string | null = null;
  if (activeDevice && now > 0) {
    try {
      nextNumber = peekNumber(activeDevice.prefix, activeDevice.counters ?? {}, istDateString(now)).number;
    } catch {
      nextNumber = null;
    }
  }

  const facts: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Connection", value: online ? "Online" : "Offline" },
    {
      label: "This device",
      value:
        device === undefined ? (
          "Checking…"
        ) : device === null ? (
          <span>
            Not registered. It can bill only while online.{" "}
            <Link href="/app/settings/devices" className="font-medium text-primary underline-offset-2 hover:underline">
              Register it
            </Link>
          </span>
        ) : device.revoked ? (
          "Deactivated by the owner. It bills online with the outlet's series."
        ) : (
          <span>
            {device.name} · series <span className="tabular font-medium">{device.prefix}</span>
            {nextNumber ? (
              <>
                {" "}
                · next bill <span className="tabular font-medium">{nextNumber}</span>
              </>
            ) : null}
          </span>
        ),
    },
    { label: "Last sync", value: now > 0 ? describeAge(lastSync, now) : "" },
    { label: "Catalog saved", value: catalogMeta && now > 0 ? `${describeAge(catalogMeta.savedAt, now)} (${catalogMeta.count} items)` : "Not saved yet" },
  ];

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        <span
          role="status"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-medium",
            online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-100 text-amber-900",
          )}
        >
          {online ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
          {online ? <span className="hidden sm:inline">Online</span> : <span>Offline</span>}
          {online ? <span className="sr-only sm:hidden">Online</span> : null}
        </span>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Pending bills: ${counts.pending} waiting to sync, ${counts.attention} need attention`}
          className={cn(counts.attention > 0 && "border-destructive/40")}
        >
          {counts.attention > 0 ? (
            <AlertTriangle className="text-destructive" aria-hidden />
          ) : counts.pending > 0 ? (
            <CloudUpload aria-hidden />
          ) : (
            <CheckCircle2 className="text-emerald-600" aria-hidden />
          )}
          <span className="tabular">{counts.pending}</span>
          <span className="hidden md:inline">pending</span>
          {counts.attention > 0 ? (
            <span className="tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.65rem] text-white">{counts.attention}</span>
          ) : null}
        </Button>

        <span className="hidden text-xs whitespace-nowrap text-muted-foreground xl:inline" title="Last time bills were sent to the server">
          {needsSignIn ? "Sign in to sync" : now > 0 ? `Synced ${describeAge(lastSync, now)}` : ""}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="hidden sm:inline-flex"
          onClick={() => void sync(true, true)}
          disabled={running}
          aria-label="Sync now"
          title="Sync now"
        >
          {running ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>Pending and conflicts</SheetTitle>
            <SheetDescription>Bills made on this device and where they stand with the server.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <dl className="grid gap-1.5 border-b p-3 text-sm">
              {facts.map((fact) => (
                <div key={fact.label} className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">{fact.label}</dt>
                  <dd className="min-w-0 flex-1">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {needsSignIn ? (
              <div className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                <p className="font-medium">You have been signed out</p>
                <p className="mt-0.5">Your bills are safe on this device. Sign in again and they will be sent.</p>
                <Button asChild size="sm" className="mt-2">
                  <a href="/login?next=/app/pos">Sign in</a>
                </Button>
              </div>
            ) : null}
            {state === "business_mismatch" ? (
              <p className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
                These bills belong to another business. Switch back to it (top of the app) to sync them.
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-2 p-3">
              <p className="text-sm text-muted-foreground">
                {counts.pending} waiting · {counts.attention} need attention
              </p>
              <Button type="button" size="sm" onClick={() => void sync(true, true)} disabled={running}>
                {running ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
                Sync now
              </Button>
            </div>

            <PendingBills
              businessId={businessId}
              rows={rows}
              device={activeDevice}
              canDiscard={canDiscard}
              onChanged={() => void sync(true)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
