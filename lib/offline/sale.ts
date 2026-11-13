/**
 * What "Pay" does on a till that may or may not have a network.
 *
 *  Not a registered device → post online with the outlet's server series, as before.
 *                            No network: refuse, keep the cart.
 *  Registered device       → the device issues the number, online and offline.
 *      online   → post through the server with that number. A business rejection is
 *                 shown and never queued. A network failure falls through to ↓ with
 *                 the SAME client_uuid and number.
 *      offline  → number + queue row in one transaction, then print from local data.
 *
 * Framework-free and storage-agnostic, so it is unit tested with an in-memory repo.
 */
import { istDateString } from "@/lib/dates";
import type { PosContext, SubmitSaleResult } from "@/lib/pos/types";
import type { PrintFormat } from "@/lib/types/db";
import type { SaleInput } from "@/lib/validation/sales";
import { bumpPast, NumberingError, reconcileCounters } from "./numbering";
import { stockDeltas } from "./queue";
import { buildLocalBill, offlineInvoiceId, type SellerSnapshot } from "./receipt";
import type { OfflineRepo, QueueRow } from "./types";

export const NOT_REGISTERED_MESSAGE = "Register this device in Settings → POS devices to bill offline.";

export interface SaleDeps {
  /** Null when this browser cannot store data (private window, blocked storage). */
  repo: OfflineRepo | null;
  outletId: string;
  context: PosContext;
  seller: SellerSnapshot;
  printFormat: PrintFormat;
  /** Posts through the server. Must resolve with code "network" when the request got no answer. */
  postOnline(input: SaleInput): Promise<SubmitSaleResult>;
  isOnline(): boolean;
  now(): Date;
  /** The server's view of this device's series, for reconciling after a number conflict. Null when unreachable. */
  fetchServerSeries?(deviceId: string): Promise<{ active: boolean; series: Array<{ fy: string; next: number }> } | null>;
}

const blocked = (message: string): SubmitSaleResult => ({ ok: false, code: "offline_unavailable", message });

export async function submitSale(deps: SaleDeps, input: SaleInput): Promise<SubmitSaleResult> {
  const { repo, outletId } = deps;
  let device = repo ? await repo.getDevice(outletId).catch(() => undefined) : undefined;
  if (device?.revoked) device = undefined;

  // ── Not registered: exactly the online POS ──
  if (!repo || !device) {
    if (!deps.isOnline()) return blocked(`You are offline. ${NOT_REGISTERED_MESSAGE}`);
    const result = await deps.postOnline(input);
    if (!result.ok && result.code === "network") {
      return { ...result, message: `Could not reach the server. Try again, or to keep billing without internet: ${NOT_REGISTERED_MESSAGE}` };
    }
    if (result.ok) await repo?.adjustStock(outletId, stockDeltas(input)).catch(() => undefined);
    return result;
  }

  // ── Registered: this device numbers the bill ──
  const at = deps.now();
  const date = istDateString(at);
  const withNumber = (number: string): SaleInput => ({
    ...input,
    device: { id: device.deviceId, key: device.key },
    invoice_number: number,
    invoice_date: date,
  });

  const queue = async (): Promise<SubmitSaleResult> => {
    let saved: { row: QueueRow; created: boolean };
    try {
      saved = await repo.enqueueBill(outletId, input.client_uuid, date, (issue) => {
        const full = withNumber(issue.number);
        const bill = buildLocalBill(full, deps.context, deps.seller, at);
        if (!bill.ok) throw new LocalBillError(bill.code, bill.message);
        return {
          clientUuid: input.client_uuid,
          outletId,
          number: issue.number,
          fy: issue.fy,
          sequence: issue.sequence,
          input: full,
          status: "pending",
          attempts: 0,
          lastError: null,
          lastCode: null,
          nextAttemptAt: 0,
          createdAt: at.getTime(),
          syncedAt: null,
          invoiceId: null,
          warnings: [],
          totalPaise: bill.view.totals.totalPaise,
          customerLabel: bill.data.customer.name || bill.data.customer.phone || "Walk-in",
          receipt: bill.view,
          printFormat: deps.printFormat,
          cashier: deps.seller.cashierName,
        };
      });
    } catch (error) {
      if (error instanceof LocalBillError) return { ok: false, code: error.code, message: error.message };
      if (error instanceof NumberingError) return { ok: false, code: "number_invalid", message: error.message };
      return blocked("This bill could not be saved on this device. Check that the browser is allowed to store data, then try again.");
    }
    const { row, created } = saved;
    // Idempotent: a second Pay for the same bill returns the row that is already there, and stock is counted once.
    if (created) await repo.adjustStock(outletId, stockDeltas(row.input)).catch(() => undefined);
    return {
      ok: true,
      invoiceId: row.invoiceId ?? offlineInvoiceId(row.clientUuid),
      invoiceNumber: row.number,
      publicToken: "",
      duplicate: false,
      warnings: [],
      queued: row.status !== "synced",
    };
  };

  // A bill that is already in the queue was printed with its number: never post it a second way.
  if (await repo.getQueueRow(input.client_uuid)) return queue();
  if (!deps.isOnline()) return queue();

  let issue;
  try {
    issue = await repo.reserveNumber(outletId, input.client_uuid, date);
  } catch (error) {
    return { ok: false, code: "number_invalid", message: error instanceof Error ? error.message : "Could not issue a bill number" };
  }
  let result = await deps.postOnline(withNumber(issue.number));

  if (!result.ok && result.code === "number_conflict") {
    // Not printed yet, so a fresh number is safe. Catch up with the server first, then try once more.
    const server = await deps.fetchServerSeries?.(device.deviceId).catch(() => null);
    const taken = issue.number;
    await repo.updateDevice(outletId, (d) => ({ ...d, counters: bumpPast(reconcileCounters(d.counters, server?.series ?? []), taken) }));
    try {
      issue = await repo.reserveNumber(outletId, input.client_uuid, date, { fresh: true });
    } catch (error) {
      return { ok: false, code: "number_invalid", message: error instanceof Error ? error.message : "Could not issue a bill number" };
    }
    result = await deps.postOnline(withNumber(issue.number));
  }

  if (result.ok) {
    await repo.releaseReservation(outletId, input.client_uuid, true).catch(() => undefined);
    await repo.adjustStock(outletId, stockDeltas(input)).catch(() => undefined);
    return result;
  }
  if (result.code === "network") return queue();

  if (result.code === "device_invalid") {
    // The owner deactivated this device. Keep the till working online with the outlet's own series.
    await repo.releaseReservation(outletId, input.client_uuid, false).catch(() => undefined);
    await repo.updateDevice(outletId, (d) => ({ ...d, revoked: true })).catch(() => undefined);
    const plain = await deps.postOnline(input);
    if (plain.ok) await repo.adjustStock(outletId, stockDeltas(input)).catch(() => undefined);
    return plain;
  }

  // A business rejection: shown to the cashier, never queued. The number goes back if it was the last one
  // issued, unless the server says that very number is taken or unusable (then it must not be offered again).
  const burnt = result.code === "number_conflict" || result.code === "number_invalid";
  await repo.releaseReservation(outletId, input.client_uuid, burnt).catch(() => undefined);
  return result;
}

class LocalBillError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
