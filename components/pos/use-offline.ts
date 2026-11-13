"use client";

import { useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getOfflineDb } from "@/lib/offline/db";
import { META_LAST_SYNC, metaCatalogKey, type CatalogMeta, type DeviceRecord, type QueueRow } from "@/lib/offline/types";

function subscribeOnline(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/** The browser's view of the connection. True on the server and until the page is live. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

let clock = 0;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeClock(notify: () => void) {
  clockListeners.add(notify);
  if (!clockTimer) {
    clock = Date.now();
    clockTimer = setInterval(() => {
      clock = Date.now();
      for (const listener of clockListeners) listener();
    }, 30_000);
  }
  return () => {
    clockListeners.delete(notify);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** The time, refreshed every 30 seconds, for "5 min ago" labels. 0 on the server. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => clock || Date.now(),
    () => 0,
  );
}

const NO_ROWS: QueueRow[] = [];

/**
 * A live query that can never throw into the render: where the browser refuses
 * to open the database (some private windows), the POS simply behaves as "not registered, online only".
 */
async function safely<T>(read: () => Promise<T | undefined> | undefined, fallback: T): Promise<T> {
  try {
    return (await read()) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Every bill kept on this device for the business, live. Empty when the browser cannot store data. */
export function useQueueRows(businessId: string): QueueRow[] {
  return useLiveQuery(() => safely(() => getOfflineDb(businessId)?.queue.toArray(), NO_ROWS), [businessId], NO_ROWS);
}

/** This browser's registration for an outlet. `undefined` while loading, `null` when not registered. */
export function useDevice(businessId: string, outletId: string): DeviceRecord | null | undefined {
  return useLiveQuery(() => safely<DeviceRecord | null>(() => getOfflineDb(businessId)?.device.get(outletId), null), [businessId, outletId], undefined);
}

export function useCatalogMeta(businessId: string, outletId: string): CatalogMeta | null {
  return useLiveQuery(
    () => safely<CatalogMeta | null>(async () => (await getOfflineDb(businessId)?.meta.get(metaCatalogKey(outletId)))?.value as CatalogMeta | undefined, null),
    [businessId, outletId],
    null,
  );
}

export function useLastSync(businessId: string): number | null {
  return useLiveQuery(
    () => safely<number | null>(async () => (await getOfflineDb(businessId)?.meta.get(META_LAST_SYNC))?.value as number | undefined, null),
    [businessId],
    null,
  );
}

const NO_DEVICES: DeviceRecord[] = [];

/** Every outlet this browser is registered for in the business. `undefined` while loading. */
export function useDevices(businessId: string): DeviceRecord[] | undefined {
  return useLiveQuery(() => safely(() => getOfflineDb(businessId)?.device.toArray(), NO_DEVICES), [businessId], undefined);
}
