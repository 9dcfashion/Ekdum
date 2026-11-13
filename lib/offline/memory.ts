/**
 * In-memory OfflineRepo. It backs the unit tests (IndexedDB does not exist in
 * Node) and mirrors the Dexie repository method for method.
 */
import type { CatalogProduct, ParkedBill, PosCustomer } from "@/lib/pos/types";
import { istDateString } from "@/lib/dates";
import { issueNumber, release, reserve, takeForQueue } from "./numbering";
import { applyStockDeltas } from "./queue";
import { matchCustomers } from "./customers";
import type { CatalogMeta, DeviceRecord, OfflineRepo, QueueRow, StockDelta } from "./types";

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

export function createMemoryRepo(now: () => number = Date.now): OfflineRepo & { queue: Map<string, QueueRow>; devices: Map<string, DeviceRecord> } {
  const devices = new Map<string, DeviceRecord>();
  const queue = new Map<string, QueueRow>();
  const catalogs = new Map<string, { products: CatalogProduct[]; meta: CatalogMeta }>();
  const parked = new Map<string, ParkedBill>();
  const meta = new Map<string, unknown>();
  let customers: PosCustomer[] = [];

  const requireDevice = (outletId: string): DeviceRecord => {
    const device = devices.get(outletId);
    if (!device) throw new Error("This device is not registered for this outlet");
    return device;
  };

  return {
    queue,
    devices,
    async getDevice(outletId) {
      return clone(devices.get(outletId));
    },
    async listDevices() {
      return clone([...devices.values()]);
    },
    async saveDevice(device) {
      devices.set(device.outletId, clone(device));
    },
    async removeDevice(outletId) {
      devices.delete(outletId);
    },
    async updateDevice(outletId, change) {
      const device = devices.get(outletId);
      if (!device) return undefined;
      const next = change(clone(device));
      devices.set(outletId, clone(next));
      return clone(next);
    },
    async reserveNumber(outletId, clientUuid, date, opts) {
      const { device, issue } = reserve(requireDevice(outletId), clientUuid, date, now(), opts);
      devices.set(outletId, device);
      return issue;
    },
    async releaseReservation(outletId, clientUuid, consumed) {
      const device = devices.get(outletId);
      if (device) devices.set(outletId, release(device, clientUuid, consumed));
    },
    async enqueueBill(outletId, clientUuid, date, build) {
      const existing = queue.get(clientUuid);
      if (existing) return { row: clone(existing), created: false };
      const { device, issue } = takeForQueue(requireDevice(outletId), clientUuid, date);
      // Build first: if it throws, neither the counter nor the queue changes.
      const row = build(issue, device);
      devices.set(outletId, device);
      queue.set(clientUuid, clone(row));
      return { row: clone(row), created: true };
    },
    async reissueNumber(clientUuid, rebuild) {
      const row = queue.get(clientUuid);
      if (!row) throw new Error("This bill is no longer on this device");
      const device = requireDevice(row.outletId);
      // The new number must be in the year of the bill's date, which is what the server checks.
      const { issue, counters } = issueNumber(device.prefix, device.counters, row.input.invoice_date ?? istDateString(row.createdAt));
      const next = rebuild(clone(row), issue);
      devices.set(row.outletId, { ...device, counters });
      queue.set(clientUuid, clone(next));
      return clone(next);
    },
    async listQueue() {
      return clone([...queue.values()]);
    },
    async getQueueRow(clientUuid) {
      return clone(queue.get(clientUuid));
    },
    async patchQueueRows(patches) {
      for (const { clientUuid, patch } of patches) {
        const row = queue.get(clientUuid);
        if (row) queue.set(clientUuid, { ...row, ...clone(patch) });
      }
    },
    async deleteQueueRows(ids) {
      for (const id of ids) queue.delete(id);
    },
    async getCatalogMeta(outletId) {
      return clone(catalogs.get(outletId)?.meta);
    },
    async loadCatalog(outletId) {
      return clone(catalogs.get(outletId)?.products ?? []);
    },
    async saveCatalog(outletId, products, m) {
      catalogs.set(outletId, { products: clone(products), meta: clone(m) });
    },
    async adjustStock(outletId, sold: StockDelta[]) {
      const entry = catalogs.get(outletId);
      if (entry) entry.products = applyStockDeltas(entry.products, sold);
    },
    async saveCustomers(list) {
      customers = clone(list);
    },
    async searchCustomers(query, limit) {
      return clone(matchCustomers(customers, query, limit));
    },
    async listParked(outletId) {
      return clone([...parked.entries()].filter(([k]) => k.startsWith(`${outletId}:`)).map(([, v]) => v)).sort((a, b) => b.parkedAt.localeCompare(a.parkedAt));
    },
    async saveParked(outletId, bill) {
      parked.set(`${outletId}:${bill.id}`, clone(bill));
    },
    async removeParked(outletId, id) {
      parked.delete(`${outletId}:${id}`);
    },
    async getMeta<T>(key: string) {
      return clone(meta.get(key)) as T | undefined;
    },
    async setMeta(key, value) {
      meta.set(key, clone(value));
    },
  };
}
