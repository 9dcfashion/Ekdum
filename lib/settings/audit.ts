import { formatINR } from "@/lib/money";

/** Action groups are the part of the action before the dot ("member.deactivated" → "member"). */
export const AUDIT_GROUPS = [
  { value: "member", label: "Staff" },
  { value: "role", label: "Roles and permissions" },
  { value: "sale", label: "Sales" },
  { value: "purchase", label: "Purchases" },
  { value: "stock", label: "Stock" },
  { value: "series", label: "Invoice series" },
  { value: "device", label: "POS devices" },
  { value: "business", label: "Business" },
] as const;

export const STAFF_AUDIT_GROUPS = ["member", "role"] as const;

export function isAuditGroup(value: string): boolean {
  return AUDIT_GROUPS.some((g) => g.value === value);
}

const ACTION_LABELS: Record<string, string> = {
  "business.created": "Business created",
  "member.joined": "Staff member joined",
  "member.deactivated": "Staff member deactivated",
  "member.reactivated": "Staff member reactivated",
  "member.role_changed": "Role changed",
  "member.outlet_access_changed": "Outlet access changed",
  "role.permission_granted": "Permission granted",
  "role.permission_revoked": "Permission removed",
  "device.registered": "POS device registered",
  "series.gap": "Gap in device bill numbers",
  "sale.cancelled": "Bill cancelled",
  "sale.credit_note": "Credit note issued",
  "sale.price_override": "Selling price changed on a bill",
  "sale.place_of_supply_override": "Place of supply changed on a bill",
  "sale.offline_discount_over_limit": "Offline bill: discount above the role limit",
  "sale.offline_price_mismatch": "Offline bill: price differs from the catalogue",
  "purchase.posted": "Purchase bill posted",
  "purchase.cancelled": "Purchase bill cancelled",
  "stock.adjusted": "Stock adjusted",
};

const ENTITY_LABELS: Record<string, string> = {
  businesses: "Business",
  business_members: "Staff member",
  roles: "Role",
  pos_devices: "POS device",
  invoice_series: "Invoice series",
  sales_invoices: "Bill",
  credit_notes: "Credit note",
  purchase_bills: "Purchase bill",
  stock_movements: "Stock",
  stock_levels: "Stock",
  products: "Product",
};

function humanise(text: string): string {
  const words = text.replace(/[._]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? humanise(action);
}

export function auditEntityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? humanise(entity);
}

type Json = Record<string, unknown> | null | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Never shown, whatever a future audit entry puts in its payload. */
const HIDDEN_KEYS = /token|secret|key_hash|password|account_number/i;

/** Every id in the before/after payloads, so the page can look up names for them in one go. */
export function collectAuditIds(entries: Array<{ before: Json; after: Json }>): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const payload of [entry.before, entry.after]) {
      for (const [key, value] of Object.entries(payload ?? {})) {
        if (key.endsWith("_id") && typeof value === "string" && UUID.test(value)) ids.add(value);
      }
    }
  }
  return [...ids];
}

function keyLabel(key: string): string {
  return humanise(key.replace(/_paise$/, "").replace(/_id$/, ""));
}

function formatValue(key: string, value: unknown, names: Readonly<Record<string, string>>): string {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return key.endsWith("_paise") ? formatINR(value) : String(value);
  if (typeof value === "string") {
    if (UUID.test(value)) return names[value] ?? "…" + value.slice(-6);
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  }
  const json = JSON.stringify(value);
  return json.length > 60 ? `${json.slice(0, 57)}…` : json;
}

/**
 * A compact, readable "before → after" line for one audit entry.
 * `names` maps ids (roles, people, outlets) to display names.
 */
export function summariseChange(before: Json, after: Json, names: Readonly<Record<string, string>> = {}, maxParts = 5): string {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !HIDDEN_KEYS.test(k));
  const parts: string[] = [];
  for (const key of keys) {
    const hasBefore = before != null && key in before;
    const hasAfter = after != null && key in after;
    const b = hasBefore ? formatValue(key, before![key], names) : null;
    const a = hasAfter ? formatValue(key, after![key], names) : null;
    if (hasBefore && hasAfter) {
      if (b !== a) parts.push(`${keyLabel(key)}: ${b} → ${a}`);
    } else if (hasAfter) {
      parts.push(`${keyLabel(key)}: ${a}`);
    } else {
      parts.push(`${keyLabel(key)}: was ${b}`);
    }
  }
  if (parts.length > maxParts) return `${parts.slice(0, maxParts).join(" · ")} · +${parts.length - maxParts} more`;
  return parts.join(" · ");
}
