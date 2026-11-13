/** Small pure helpers and the user-driven actions on queued bills (retry, re-issue, discard). */
import { Decimal } from "@/lib/money";
import type { CatalogProduct } from "@/lib/pos/types";
import type { SaleInput } from "@/lib/validation/sales";
import type { OfflineRepo, QueueRow, QueueStatus, StockDelta } from "./types";

/** Statuses of bills the server does not have yet. */
export const UNSYNCED: readonly QueueStatus[] = ["pending", "syncing", "failed", "conflict"];

export const isUnsynced = (row: Pick<QueueRow, "status">) => UNSYNCED.includes(row.status);

export interface QueueCounts {
  /** Waiting to be sent (includes those being sent right now). */
  pending: number;
  /** Need a person: refused by the server, or given up after repeated server errors. */
  attention: number;
  synced: number;
}

export function countQueue(rows: QueueRow[]): QueueCounts {
  const counts: QueueCounts = { pending: 0, attention: 0, synced: 0 };
  for (const row of rows) {
    if (row.status === "pending" || row.status === "syncing") counts.pending += 1;
    else if (row.status === "conflict" || row.status === "failed") counts.attention += 1;
    else counts.synced += 1;
  }
  return counts;
}

/** Stock leaving the shop on a bill: one entry per product line. */
export function stockDeltas(input: Pick<SaleInput, "lines">): StockDelta[] {
  return input.lines.filter((l) => !!l.product_id).map((l) => ({ productId: l.product_id as string, quantity: String(l.quantity) }));
}

/** Take quantities off a catalog. Products whose stock is unknown or not tracked are left alone. */
export function applyStockDeltas(catalog: CatalogProduct[], deltas: StockDelta[]): CatalogProduct[] {
  if (deltas.length === 0) return catalog;
  const sold = new Map<string, Decimal>();
  for (const d of deltas) sold.set(d.productId, (sold.get(d.productId) ?? new Decimal(0)).plus(d.quantity));
  return catalog.map((p) => {
    const qty = sold.get(p.id);
    if (!qty || p.stock === null || !p.track_inventory) return p;
    return { ...p, stock: new Decimal(p.stock).minus(qty).toNumber() };
  });
}

/**
 * A catalog fresh from the server does not know about bills still waiting on
 * this device. Take them off, so the till shows what is really on the shelf.
 */
export function subtractUnsynced(catalog: CatalogProduct[], rows: QueueRow[], outletId: string): CatalogProduct[] {
  const deltas = rows.filter((r) => r.outletId === outletId && isUnsynced(r)).flatMap((r) => stockDeltas(r.input));
  return applyStockDeltas(catalog, deltas);
}

export class QueueActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueActionError";
  }
}

/** Put a conflicted or failed bill back in line, to be sent again as it is. */
export async function retryBill(repo: OfflineRepo, clientUuid: string): Promise<void> {
  const row = await repo.getQueueRow(clientUuid);
  if (!row) throw new QueueActionError("This bill is no longer on this device");
  if (row.status === "synced") return;
  await repo.patchQueueRows([{ clientUuid, patch: { status: "pending", nextAttemptAt: 0 } }]);
}

/**
 * Give a bill whose number was already taken the device's next number.
 * Explicit only: the printed copy carries the old number and must be reprinted.
 */
export async function reissueBill(repo: OfflineRepo, clientUuid: string): Promise<QueueRow> {
  return repo.reissueNumber(clientUuid, (row, issue) => {
    if (row.status !== "conflict" || row.lastCode !== "number_conflict") {
      throw new QueueActionError("Only a bill whose number was already used can get a new number");
    }
    const receipt = {
      ...row.receipt,
      number: issue.number,
      upi: row.receipt.upi ? { ...row.receipt.upi, uri: row.receipt.upi.uri.split(encodeURIComponent(row.number)).join(encodeURIComponent(issue.number)) } : null,
    };
    return {
      ...row,
      number: issue.number,
      fy: issue.fy,
      sequence: issue.sequence,
      input: { ...row.input, invoice_number: issue.number },
      receipt,
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      lastCode: null,
      reissuedFrom: row.reissuedFrom ?? row.number,
    };
  });
}

/**
 * Remove a bill the server refused. The printed copy then has no record
 * anywhere, so the caller must have confirmed by typing the bill number.
 */
export async function discardBill(repo: OfflineRepo, clientUuid: string, typedNumber: string): Promise<void> {
  const row = await repo.getQueueRow(clientUuid);
  if (!row) return;
  if (row.status !== "conflict" && row.status !== "failed") throw new QueueActionError("Only a bill the server refused can be discarded");
  if (typedNumber.trim().toUpperCase() !== row.number) throw new QueueActionError("The bill number does not match");
  await repo.deleteQueueRows([clientUuid]);
}
