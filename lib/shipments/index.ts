/** Pure helpers for the shipments module (no server or browser APIs). */

export const SHIPMENT_STATUSES = ["booked", "picked_up", "in_transit", "delivered", "rto", "cancelled"] as const;
export type ShipmentStatusKey = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatusKey, string> = {
  booked: "Booked",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
  rto: "RTO (returned)",
  cancelled: "Cancelled",
};

export function isShipmentStatus(value: unknown): value is ShipmentStatusKey {
  return typeof value === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

/** Friendly label for a status; unknown values are shown as they are. */
export function shipmentStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  return isShipmentStatus(status) ? SHIPMENT_STATUS_LABELS[status] : status;
}

/** Statuses where the parcel is still on its way (not delivered, returned or cancelled). */
export const OPEN_STATUSES: readonly ShipmentStatusKey[] = ["booked", "picked_up", "in_transit"];

export function isOpenStatus(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

const NEXT: Record<ShipmentStatusKey, readonly ShipmentStatusKey[]> = {
  booked: ["picked_up", "in_transit", "cancelled"],
  picked_up: ["in_transit", "delivered", "rto"],
  in_transit: ["delivered", "rto"],
  delivered: [],
  rto: [],
  cancelled: [],
};

/** The sensible next steps from a status, most likely first. Empty for finished shipments. */
export function nextStatuses(status: string): ShipmentStatusKey[] {
  return isShipmentStatus(status) ? [...NEXT[status]] : [];
}

/** Every other status, for corrections through the "More" menu. */
export function otherStatuses(status: string): ShipmentStatusKey[] {
  const next = nextStatuses(status);
  return SHIPMENT_STATUSES.filter((s) => s !== status && !next.includes(s));
}

/** Changes that should ask "are you sure?": cancelling, RTO, or correcting a finished shipment. */
export function needsConfirmation(from: string, to: string): boolean {
  return to === "cancelled" || to === "rto" || !isOpenStatus(from);
}

/**
 * The courier's tracking page for a tracking number (AWB).
 * Returns null when there is no template or number, when the template has no
 * {awb} placeholder, or when the result is not a plain http(s) link
 * (so a template such as "javascript:..." can never become a clickable link).
 */
export function buildTrackingUrl(template: string | null | undefined, awb: string | null | undefined): string | null {
  const t = (template ?? "").trim();
  const number = (awb ?? "").trim();
  if (!t || !number || !t.includes("{awb}")) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  const url = t.split("{awb}").join(encodeURIComponent(number));
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whole days from the shipped date to `today` (both IST calendar dates, "YYYY-MM-DD").
 * Never negative: a shipment dated in the future counts as 0.
 */
export function daysOpen(shippedOn: string | null | undefined, today: string): number {
  const from = parseDay(shippedOn);
  const to = parseDay(today);
  if (from === null || to === null) return 0;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/** "Today", "1 day", "6 days". */
export function daysOpenLabel(days: number): string {
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** Same rule as the dashboard: still open and shipped at least `stuckDays` days ago. */
export function isStuck(status: string, shippedOn: string | null | undefined, stuckDays: number, today: string): boolean {
  if (!isOpenStatus(status) || !(stuckDays > 0)) return false;
  return daysOpen(shippedOn, today) >= stuckDays;
}

/**
 * A bill stores the customer's address as one block of text; a shipment has two lines.
 * Puts as much as fits (at a comma or space) on line 1 and the rest on line 2.
 */
export function splitAddress(address: string | null | undefined, max = 200): { line1: string; line2: string } {
  const text = (address ?? "").replace(/[,\s]*[\r\n]+\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return { line1: text, line2: "" };
  const head = text.slice(0, max + 1);
  let cut = Math.max(head.lastIndexOf(","), head.lastIndexOf(" "));
  if (cut < max / 2) cut = max;
  const line1 = text.slice(0, cut).replace(/[,\s]+$/, "");
  const line2 = text.slice(cut).replace(/^[,\s]+/, "").slice(0, max).trim();
  return { line1, line2 };
}

/** List tabs → the statuses they show (`null` = every status). */
export const SHIPMENT_TABS = [
  { key: "pending", label: "Pending pickup", statuses: ["booked"] },
  { key: "transit", label: "In transit", statuses: ["picked_up", "in_transit"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "rto", label: "RTO", statuses: ["rto"] },
  { key: "all", label: "All", statuses: null },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly ShipmentStatusKey[] | null }>;

export type ShipmentTabKey = (typeof SHIPMENT_TABS)[number]["key"];

export function resolveTab(value: string | null | undefined): ShipmentTabKey {
  return SHIPMENT_TABS.find((t) => t.key === value)?.key ?? "pending";
}

export const MAX_RECEIPT_PHOTOS = 12;

/** Receipt photos live under `{businessId}/receipts/` in the private bucket. */
export function isReceiptPathFor(businessId: string, path: string): boolean {
  return path.startsWith(`${businessId}/receipts/`) && !path.includes("..") && !/[\\\s]/.test(path) && path.length <= 300;
}

/** The parts of a bill used to prefill a shipment. */
export interface InvoiceMatch {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_pincode: string | null;
  customer_state_code: string | null;
  total_paise: number;
}
