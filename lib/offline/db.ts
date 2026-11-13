/**
 * The offline POS database (IndexedDB through Dexie).
 *
 * One database PER BUSINESS (`ekdum-pos-{businessId}`), and every outlet-level
 * row carries its outlet id, so two businesses or two outlets on one browser
 * can never see each other's catalog, device key, held bills or queued bills.
 *
 * Only this file touches Dexie. Everything else goes through `OfflineRepo`.
 */
import Dexie, { type Table } from "dexie";
import { istDateString } from "@/lib/dates";
import type { CatalogProduct, ParkedBill, PosCustomer } from "@/lib/pos/types";
import { matchCustomers } from "./customers";
import { issueNumber, release, reserve, takeForQueue } from "./numbering";
import { applyStockDeltas } from "./queue";
import { metaCatalogKey, type CatalogMeta, type DeviceRecord, type OfflineRepo, type QueueRow } from "./types";

export const OFFLINE_DB_VERSION = 1;
export const offlineDbName = (businessId: string) => `ekdum-pos-${businessId}`;

export type CatalogRow = CatalogProduct & { outletId: string };
export type ParkedRow = ParkedBill & { outletId: string };
export interface MetaRow {
  key: string;
  value: unknown;
}

export class EkdumOfflineDb extends Dexie {
  catalog!: Table<CatalogRow, [string, string]>;
  customers!: Table<PosCustomer, string>;
  device!: Table<DeviceRecord, string>;
  parked!: Table<ParkedRow, [string, string]>;
  queue!: Table<QueueRow, string>;
  meta!: Table<MetaRow, string>;

  constructor(businessId: string) {
    super(offlineDbName(businessId));
    // Version 1. To change the shape later, add `this.version(2).stores({...}).upgrade(...)`
    // below and never edit a version that has shipped.
    this.version(OFFLINE_DB_VERSION).stores({
      catalog: "[outletId+id], outletId",
      customers: "id",
      device: "outletId",
      parked: "[outletId+id], outletId",
      queue: "clientUuid, outletId, status, createdAt",
      meta: "key",
    });
  }
}

const open = new Map<string, EkdumOfflineDb>();

export function offlineStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

/** The database of one business, or null where IndexedDB does not exist (server render, locked-down browsers). */
export function getOfflineDb(businessId: string): EkdumOfflineDb | null {
  if (!offlineStorageAvailable() || !businessId) return null;
  let db = open.get(businessId);
  if (!db) {
    db = new EkdumOfflineDb(businessId);
    open.set(businessId, db);
  }
  return db;
}

/**
 * Bill numbers are issued inside an IndexedDB read-write transaction on the
 * device row, which the browser already runs one at a time across tabs. The Web
 * Lock on top is a second guard for browsers with unusual transaction timing.
 */
async function numberLock<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  return locks.request(`ekdum.numbers.${businessId}`, fn);
}

export function createDexieRepo(db: EkdumOfflineDb, businessId: string): OfflineRepo {
  const requireDevice = async (outletId: string): Promise<DeviceRecord> => {
    const device = await db.device.get(outletId);
    if (!device) throw new Error("This device is not registered for this outlet");
    return { ...device, reservations: device.reservations ?? {}, counters: device.counters ?? {} };
  };

  return {
    getDevice: (outletId) => db.device.get(outletId),
    listDevices: () => db.device.toArray(),
    async saveDevice(device) {
      await db.device.put(device);
    },
    async removeDevice(outletId) {
      await db.device.delete(outletId);
    },
    updateDevice(outletId, change) {
      return db.transaction("rw", db.device, async () => {
        const device = await db.device.get(outletId);
        if (!device) return undefined;
        const next = change(device);
        await db.device.put(next);
        return next;
      });
    },

    reserveNumber(outletId, clientUuid, date, opts) {
      return numberLock(businessId, () =>
        db.transaction("rw", db.device, async () => {
          const { device, issue } = reserve(await requireDevice(outletId), clientUuid, date, Date.now(), opts);
          await db.device.put(device);
          return issue;
        }),
      );
    },
    async releaseReservation(outletId, clientUuid, consumed) {
      await numberLock(businessId, () =>
        db.transaction("rw", db.device, async () => {
          const device = await db.device.get(outletId);
          if (device) await db.device.put(release({ ...device, reservations: device.reservations ?? {} }, clientUuid, consumed));
        }),
      );
    },
    enqueueBill(outletId, clientUuid, date, build) {
      return numberLock(businessId, () =>
        // One transaction over both tables: the counter moves if and only if the bill is saved.
        db.transaction("rw", db.device, db.queue, async () => {
          const existing = await db.queue.get(clientUuid);
          if (existing) return { row: existing, created: false };
          const { device, issue } = takeForQueue(await requireDevice(outletId), clientUuid, date);
          const row = build(issue, device);
          await db.device.put(device);
          await db.queue.add(row);
          return { row, created: true };
        }),
      );
    },
    reissueNumber(clientUuid, rebuild) {
      return numberLock(businessId, () =>
        db.transaction("rw", db.device, db.queue, async () => {
          const row = await db.queue.get(clientUuid);
          if (!row) throw new Error("This bill is no longer on this device");
          const device = await requireDevice(row.outletId);
          // The new number must be in the year of the bill's date, which is what the server checks.
          const { issue, counters } = issueNumber(device.prefix, device.counters, row.input.invoice_date ?? istDateString(row.createdAt));
          const next = rebuild(row, issue);
          await db.device.put({ ...device, counters });
          await db.queue.put(next);
          return next;
        }),
      );
    },

    listQueue: () => db.queue.toArray(),
    getQueueRow: (clientUuid) => db.queue.get(clientUuid),
    async patchQueueRows(patches) {
      if (patches.length === 0) return;
      await db.transaction("rw", db.queue, async () => {
        for (const { clientUuid, patch } of patches) await db.queue.update(clientUuid, patch);
      });
    },
    async deleteQueueRows(ids) {
      await db.queue.bulkDelete(ids);
    },

    async getCatalogMeta(outletId) {
      return (await db.meta.get(metaCatalogKey(outletId)))?.value as CatalogMeta | undefined;
    },
    async loadCatalog(outletId) {
      const rows = await db.catalog.where("outletId").equals(outletId).toArray();
      return rows
        .map((row) => {
          const product: Partial<CatalogRow> = { ...row };
          delete product.outletId;
          return product as CatalogProduct;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async saveCatalog(outletId, products, meta) {
      await db.transaction("rw", db.catalog, db.meta, async () => {
        await db.catalog.where("outletId").equals(outletId).delete();
        await db.catalog.bulkPut(products.map((p) => ({ ...p, outletId })));
        await db.meta.put({ key: metaCatalogKey(outletId), value: meta });
      });
    },
    async adjustStock(outletId, sold) {
      if (sold.length === 0) return;
      await db.transaction("rw", db.catalog, async () => {
        const keys = [...new Set(sold.map((s) => s.productId))].map((id) => [outletId, id] as [string, string]);
        const rows = (await db.catalog.bulkGet(keys)).filter((r): r is CatalogRow => !!r);
        const next = applyStockDeltas(rows, sold) as CatalogRow[];
        await db.catalog.bulkPut(next);
      });
    },
    async saveCustomers(customers) {
      await db.transaction("rw", db.customers, async () => {
        await db.customers.clear();
        await db.customers.bulkPut(customers);
      });
    },
    async searchCustomers(query, limit) {
      // A few thousand small rows: scanning them is quicker than keeping extra indexes fresh.
      return matchCustomers(await db.customers.toArray(), query, limit);
    },

    async listParked(outletId) {
      const rows = await db.parked.where("outletId").equals(outletId).toArray();
      return rows
        .map((row) => {
          const bill: Partial<ParkedRow> = { ...row };
          delete bill.outletId;
          return bill as ParkedBill;
        })
        .sort((a, b) => b.parkedAt.localeCompare(a.parkedAt));
    },
    async saveParked(outletId, bill) {
      await db.parked.put({ ...bill, outletId });
    },
    async removeParked(outletId, id) {
      await db.parked.delete([outletId, id]);
    },

    async getMeta<T>(key: string) {
      return ((await db.meta.get(key))?.value ?? undefined) as T | undefined;
    },
    async setMeta(key, value) {
      await db.meta.put({ key, value });
    },
  };
}

const repos = new Map<string, OfflineRepo>();

/** The repository for one business, or null when this browser cannot store data. */
export function getOfflineRepo(businessId: string): OfflineRepo | null {
  const db = getOfflineDb(businessId);
  if (!db) return null;
  let repo = repos.get(businessId);
  if (!repo) {
    repo = createDexieRepo(db, businessId);
    repos.set(businessId, repo);
  }
  return repo;
}

/** Ask the browser not to evict this site's data under storage pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
