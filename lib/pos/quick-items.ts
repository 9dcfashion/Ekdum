/**
 * Quick items: preset buttons such as "Necklace" (GST 3%, HSN 7117) that are
 * billed by typing only the rate and quantity. They become manual lines on
 * the bill (no product, no stock), through the same `addManualItem` path.
 * Pure helpers only; the screen keeps the last rates in localStorage.
 */
import { formatRate } from "@/lib/gst";
import { Decimal } from "@/lib/money";
import type { ManualItemInput, QuickItem } from "./types";

/** localStorage key for the last rate typed for each quick item, per business. */
export function lastRateStorageKey(businessId: string): string {
  return `ekdum.pos.quick-rates.${businessId}`;
}

/** The stored last rates ({ quickItemId: paise }), keeping only sensible entries. */
export function parseLastRates(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const rates: Record<string, number> = {};
    for (const [id, paise] of Object.entries(value as Record<string, unknown>)) {
      if (id && typeof paise === "number" && Number.isInteger(paise) && paise > 0) rates[id] = paise;
    }
    return rates;
  } catch {
    return {};
  }
}

/** Remember the rate just billed for a quick item. Returns a new object; invalid rates are ignored. */
export function rememberRate(rates: Record<string, number>, itemId: string, paise: number): Record<string, number> {
  if (!itemId || !Number.isInteger(paise) || paise <= 0) return rates;
  return { ...rates, [itemId]: paise };
}

/** What the Rate field starts with: the last rate used on this device, else the item's default, else empty. */
export function initialRatePaise(item: Pick<QuickItem, "id" | "defaultRatePaise">, rates: Record<string, number>): number | null {
  const last = rates[item.id];
  if (last !== undefined) return last;
  return item.defaultRatePaise !== null && item.defaultRatePaise > 0 ? item.defaultRatePaise : null;
}

/** The manual line for a quick item with the quantity and rate typed by the cashier. */
export function quickItemInput(item: QuickItem, entry: { key: string; quantity: string; ratePaise: number }): ManualItemInput {
  return {
    key: entry.key,
    name: item.name,
    quantity: entry.quantity.trim(),
    unitPricePaise: entry.ratePaise,
    priceIncludesTax: item.priceIncludesTax,
    gstRate: Number(item.gstRate) || 0,
    hsnCode: item.hsnCode ?? "",
    unitCode: item.unitCode,
    allowDecimal: item.allowDecimal,
  };
}

/** "GST 3% extra · HSN 7117", "GST 3% incl.", or "No GST" when the business does not charge GST. */
export function quickItemTaxLabel(item: Pick<QuickItem, "gstRate" | "hsnCode" | "priceIncludesTax">, chargesTax: boolean): string {
  const parts = [chargesTax ? `GST ${formatRate(item.gstRate)} ${item.priceIncludesTax ? "incl." : "extra"}` : "No GST"];
  if (item.hsnCode) parts.push(`HSN ${item.hsnCode}`);
  return parts.join(" · ");
}

/**
 * The − / + buttons next to the quantity. Never goes to zero or below (the
 * current value stays), and a quantity that is not a number starts again at 1.
 */
export function stepQuantity(current: string, delta: number, allowDecimal: boolean): string {
  let value: Decimal;
  try {
    value = new Decimal(current.trim() || "0");
  } catch {
    return "1";
  }
  if (!value.isFinite() || value.lessThanOrEqualTo(0) || (!allowDecimal && !value.isInteger())) return "1";
  const next = value.plus(delta);
  return next.lessThanOrEqualTo(0) ? value.toFixed() : next.toFixed();
}

/** Quick items whose name contains every typed word (case ignored). Nothing typed: all of them. */
export function filterQuickItems<T extends Pick<QuickItem, "name">>(items: readonly T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const name = item.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}
