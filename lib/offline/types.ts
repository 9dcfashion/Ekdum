/**
 * Shapes of everything the offline POS keeps on the device, and the thin
 * repository interface the engine talks to. Dexie implements it in the browser
 * (db.ts); the unit tests use an in-memory fake (memory.ts).
 */
import type { InvoiceView } from "@/lib/invoices/view";
import type { CatalogProduct, ParkedBill, PosCustomer } from "@/lib/pos/types";
import type { PrintFormat } from "@/lib/types/db";
import type { SaleInput } from "@/lib/validation/sales";

/** Next sequence to issue per financial year, e.g. { "2627": 43 }. A missing year starts at 1. */
export type Counters = Record<string, number>;

/** A number set aside for a bill that is being posted online right now. */
export interface Reservation {
  number: string;
  fy: string;
  sequence: number;
  at: number;
}

/** This browser's registration as a POS device for one outlet. The key never leaves the device except to the server. */
export interface DeviceRecord {
  outletId: string;
  deviceId: string;
  /** The secret. Its SHA-256 is what the server stores. */
  key: string;
  name: string;
  prefix: string;
  counters: Counters;
  /** client_uuid → the number held for it while an online post is in flight or was rejected. */
  reservations: Record<string, Reservation>;
  registeredAt: number;
  /** Set when the server says the device was deactivated or no longer exists. */
  revoked?: boolean;
}

export type QueueStatus = "pending" | "syncing" | "synced" | "conflict" | "failed";

/** One bill saved on the device and waiting for (or done with) the server. */
export interface QueueRow {
  clientUuid: string;
  outletId: string;
  /** The number printed on the bill. */
  number: string;
  fy: string;
  sequence: number;
  /** The full payload for /api/pos/sync, including the device and its number. */
  input: SaleInput;
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  lastCode: string | null;
  /** Earliest time (ms) of the next automatic try. */
  nextAttemptAt: number;
  createdAt: number;
  syncedAt: number | null;
  /** Server id once synced. */
  invoiceId: string | null;
  warnings: Array<{ code: string; message: string }>;
  totalPaise: number;
  customerLabel: string;
  /** Everything needed to print the slip again with no network. */
  receipt: InvoiceView;
  printFormat: PrintFormat;
  /** Who made the bill, as printed on the slip. */
  cashier: string | null;
  /** The number this bill carried before it was issued again after a number conflict. */
  reissuedFrom?: string;
}

export interface CatalogMeta {
  /** Server time the snapshot was taken (ISO). */
  version: string;
  /** Device clock when it was saved (ms), for "5 min ago". */
  savedAt: number;
  count: number;
}

export interface NumberIssue {
  number: string;
  fy: string;
  sequence: number;
}

/** Stock sold on a bill, per product. */
export interface StockDelta {
  productId: string;
  quantity: string;
}

/** Storage for the offline POS of ONE business. Every method is atomic. */
export interface OfflineRepo {
  // ── Device and numbering ──
  getDevice(outletId: string): Promise<DeviceRecord | undefined>;
  listDevices(): Promise<DeviceRecord[]>;
  saveDevice(device: DeviceRecord): Promise<void>;
  removeDevice(outletId: string): Promise<void>;
  /** Read-modify-write of the device row in one transaction. Returns the saved row. */
  updateDevice(outletId: string, change: (device: DeviceRecord) => DeviceRecord): Promise<DeviceRecord | undefined>;
  /**
   * Hold the next number for a bill that is about to be posted online. Asking again
   * for the same bill returns the same number (unless `fresh`, or the year changed).
   */
  reserveNumber(outletId: string, clientUuid: string, date: string, opts?: { fresh?: boolean }): Promise<NumberIssue>;
  /** The online post went through (`consumed`) or was rejected (give the number back if it is still the last one). */
  releaseReservation(outletId: string, clientUuid: string, consumed: boolean): Promise<void>;
  /**
   * The heart of offline billing: in ONE transaction take the bill's number (its
   * reservation, or the next one) and save the bill to the queue. If the bill is
   * already queued, returns that row untouched with `created: false`.
   */
  enqueueBill(
    outletId: string,
    clientUuid: string,
    date: string,
    build: (issue: NumberIssue, device: DeviceRecord) => QueueRow,
  ): Promise<{ row: QueueRow; created: boolean }>;
  /** Give a queued bill the device's next number (explicit fix for a number conflict). */
  reissueNumber(clientUuid: string, rebuild: (row: QueueRow, issue: NumberIssue) => QueueRow): Promise<QueueRow>;

  // ── Queue ──
  listQueue(): Promise<QueueRow[]>;
  getQueueRow(clientUuid: string): Promise<QueueRow | undefined>;
  patchQueueRows(patches: Array<{ clientUuid: string; patch: Partial<QueueRow> }>): Promise<void>;
  deleteQueueRows(clientUuids: string[]): Promise<void>;

  // ── Catalog and customers ──
  getCatalogMeta(outletId: string): Promise<CatalogMeta | undefined>;
  loadCatalog(outletId: string): Promise<CatalogProduct[]>;
  saveCatalog(outletId: string, products: CatalogProduct[], meta: CatalogMeta): Promise<void>;
  adjustStock(outletId: string, sold: StockDelta[]): Promise<void>;
  saveCustomers(customers: PosCustomer[]): Promise<void>;
  searchCustomers(query: string, limit: number): Promise<PosCustomer[]>;

  // ── Held bills ──
  listParked(outletId: string): Promise<ParkedBill[]>;
  saveParked(outletId: string, bill: ParkedBill): Promise<void>;
  removeParked(outletId: string, id: string): Promise<void>;

  // ── Small values ──
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export const META_LAST_SYNC = "sync.last";
export const metaCatalogKey = (outletId: string) => `catalog.${outletId}`;
export const META_CUSTOMERS = "customers.savedAt";
