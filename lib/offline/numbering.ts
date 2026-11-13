/**
 * The device's own bill numbers (spec 8.4): {PREFIX}/{FY}/{SEQ} from a local
 * counter per financial year, online and offline. Pure functions; the repository
 * runs them inside a transaction so two tabs can never issue the same number.
 */
import { financialYear } from "@/lib/dates";
import { formatInvoiceNumber, maxSequenceForPrefix, parseInvoiceNumber } from "@/lib/gst/numbering";
import type { Counters, DeviceRecord, NumberIssue, Reservation } from "./types";

/** Reservations older than this belong to a bill that was abandoned (tab closed mid-post). */
export const RESERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class NumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberingError";
  }
}

/** The next sequence for a financial year. A year the device has not billed in starts at 1. */
export function nextSequence(counters: Counters, fy: string): number {
  const next = counters[fy];
  return Number.isSafeInteger(next) && next >= 1 ? next : 1;
}

/** The number the device would print next for a bill dated `date` (IST, YYYY-MM-DD), without issuing it. */
export function peekNumber(prefix: string, counters: Counters, date: string): NumberIssue {
  const fy = financialYear(date);
  const sequence = nextSequence(counters, fy);
  if (sequence > maxSequenceForPrefix(prefix)) {
    throw new NumberingError(`The series ${prefix} has run out of numbers for this year. Register this device again with a new prefix.`);
  }
  return { number: formatInvoiceNumber(prefix, fy, sequence), fy, sequence };
}

/** Issue the next number for `date` and return the advanced counters. */
export function issueNumber(prefix: string, counters: Counters, date: string): { issue: NumberIssue; counters: Counters } {
  const issue = peekNumber(prefix, counters, date);
  return { issue, counters: { ...counters, [issue.fy]: issue.sequence + 1 } };
}

/**
 * Bring the local counters in line with the server's series rows:
 * local = max(local, server). The device never moves backwards, so a number it
 * has already printed is never issued again.
 */
export function reconcileCounters(local: Counters, server: Array<{ fy: string; next: number }>): Counters {
  const merged: Counters = { ...local };
  for (const row of server) {
    if (!/^\d{4}$/.test(row.fy) || !Number.isSafeInteger(row.next) || row.next < 1) continue;
    merged[row.fy] = Math.max(nextSequence(merged, row.fy), row.next);
  }
  return merged;
}

/** Make sure the counter is past a number that turned out to be taken. */
export function bumpPast(counters: Counters, number: string): Counters {
  const parsed = parseInvoiceNumber(number);
  if (!parsed) return counters;
  return { ...counters, [parsed.fy]: Math.max(nextSequence(counters, parsed.fy), parsed.sequence + 1) };
}

/**
 * Take a number for a bill that is about to be posted online. The same bill
 * (client_uuid) gets the same number on every retry in the same financial year.
 */
export function reserve(
  device: DeviceRecord,
  clientUuid: string,
  date: string,
  now: number,
  opts: { fresh?: boolean } = {},
): { device: DeviceRecord; issue: NumberIssue } {
  const fy = financialYear(date);
  const reservations = pruneReservations(device.reservations, now);
  const held = reservations[clientUuid];
  if (held && held.fy === fy && !opts.fresh) {
    return { device: { ...device, reservations }, issue: { number: held.number, fy: held.fy, sequence: held.sequence } };
  }
  const { issue, counters } = issueNumber(device.prefix, device.counters, date);
  return {
    device: { ...device, counters, reservations: { ...reservations, [clientUuid]: { ...issue, at: now } } },
    issue,
  };
}

/**
 * Let go of a reservation. When the bill was not posted and its number is still
 * the last one issued, the counter steps back so no gap is left in the series.
 */
export function release(device: DeviceRecord, clientUuid: string, consumed: boolean): DeviceRecord {
  const held = device.reservations[clientUuid];
  if (!held) return device;
  const reservations = { ...device.reservations };
  delete reservations[clientUuid];
  const counters = { ...device.counters };
  if (!consumed && nextSequence(counters, held.fy) === held.sequence + 1) counters[held.fy] = held.sequence;
  return { ...device, counters, reservations };
}

export function pruneReservations(reservations: Record<string, Reservation>, now: number): Record<string, Reservation> {
  const kept: Record<string, Reservation> = {};
  for (const [id, r] of Object.entries(reservations ?? {})) {
    if (now - r.at < RESERVATION_MAX_AGE_MS) kept[id] = r;
  }
  return kept;
}

/** Take the bill's number for the queue: its reservation if it has one for this year, otherwise the next number. */
export function takeForQueue(device: DeviceRecord, clientUuid: string, date: string): { device: DeviceRecord; issue: NumberIssue } {
  const fy = financialYear(date);
  const held = device.reservations?.[clientUuid];
  const reservations = { ...(device.reservations ?? {}) };
  delete reservations[clientUuid];
  if (held && held.fy === fy) {
    return { device: { ...device, reservations }, issue: { number: held.number, fy: held.fy, sequence: held.sequence } };
  }
  const { issue, counters } = issueNumber(device.prefix, device.counters, date);
  return { device: { ...device, counters, reservations }, issue };
}

/** Sort key that puts bill numbers in the order they were issued: year first, then sequence. */
export function compareNumbers(a: string, b: string): number {
  const x = parseInvoiceNumber(a);
  const y = parseInvoiceNumber(b);
  if (!x || !y) return x ? -1 : y ? 1 : a.localeCompare(b);
  if (x.fy !== y.fy) return x.fy.localeCompare(y.fy);
  if (x.prefix !== y.prefix) return x.prefix.localeCompare(y.prefix);
  return x.sequence - y.sequence;
}
