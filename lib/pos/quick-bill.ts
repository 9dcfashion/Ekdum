/**
 * Pure helpers for the phone "quick bill" flow: which product tiles to show
 * and in what order, the "recent items" list kept on the device, the cash
 * quick-pick amounts, and matching a code read by the phone camera.
 * No React and no storage access here, so all of it is unit tested.
 */
import { formatINR } from "@/lib/money";
import { searchCatalog, type CatalogIndex } from "./search";
import type { CatalogProduct } from "./types";

/** How many recently billed products a device remembers (per business and outlet). */
export const MAX_RECENT = 24;

/** localStorage key for the recent items of one till. */
export function recentStorageKey(businessId: string, outletId: string): string {
  return `ekdum.pos.recent.${businessId}.${outletId}`;
}

/** The stored recent list, or [] when it is missing or not what we wrote. */
export function parseRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids = value.filter((v): v is string => typeof v === "string" && v.length > 0);
    return Array.from(new Set(ids)).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/**
 * Put the products of a bill that was just saved at the front of the recent
 * list (in the order given, no duplicates), keeping at most `max`.
 */
export function pushRecent(current: string[], productIds: Array<string | null | undefined>, max = MAX_RECENT): string[] {
  const fresh = productIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set([...fresh, ...current])).slice(0, Math.max(max, 0));
}

const collator = new Intl.Collator("en-IN", { sensitivity: "base", numeric: true });

/** Products A to Z (case and accents ignored, "Item 2" before "Item 10"). Returns a new array. */
export function sortByName(products: readonly CatalogProduct[]): CatalogProduct[] {
  return [...products].sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

export interface TileList {
  items: CatalogProduct[];
  /** The first `recentCount` items are the "Recent" group (only when nothing is typed). */
  recentCount: number;
}

/**
 * The tiles under the search box.
 * Nothing typed: the products this device billed most recently, then the rest A to Z.
 * Something typed: every product whose name, SKU or barcode matches, best matches first.
 * `alphabetical` is `sortByName(catalog)`, passed in so it is sorted once per catalog, not per keystroke.
 */
export function tileList(index: CatalogIndex, query: string, recentIds: readonly string[], alphabetical: readonly CatalogProduct[]): TileList {
  if (query.trim()) return { items: searchCatalog(index, query, Number.MAX_SAFE_INTEGER), recentCount: 0 };
  const recent: CatalogProduct[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    const product = index.byId.get(id);
    if (product && !seen.has(id)) {
      recent.push(product);
      seen.add(id);
    }
  }
  const rest = alphabetical.filter((p) => !seen.has(p.id));
  return { items: [...recent, ...rest], recentCount: recent.length };
}

/**
 * Amounts a customer is likely to hand over for cash: the exact amount, then
 * the next ₹100, ₹500 and ₹2000 at or above it. In paise, ascending, no repeats.
 */
export function cashChips(totalPaise: number): number[] {
  if (!Number.isInteger(totalPaise) || totalPaise <= 0) return [];
  const up = (step: number) => Math.ceil(totalPaise / step) * step;
  return Array.from(new Set([totalPaise, up(100_00), up(500_00), up(2000_00)])).sort((a, b) => a - b);
}

const wholeRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** A rupee amount for a button: "₹1,300" for whole rupees, "₹1,234.50" otherwise. */
export function shortINR(paise: number): string {
  return Number.isInteger(paise) && paise % 100 === 0 ? `₹${wholeRupees.format(paise / 100)}` : formatINR(paise);
}

/**
 * The product for a code read by the camera, with the same rules as a USB
 * scanner: exact barcode first, then exact SKU. A 12-digit UPC-A and the same
 * code saved as a 13-digit EAN (leading 0) are treated as one code.
 * Never a fuzzy name match: the camera must add exactly the item that was scanned.
 */
export function matchScannedCode(index: CatalogIndex, raw: string): CatalogProduct | null {
  const code = raw.trim().toLowerCase();
  if (!code) return null;
  const candidates = [code];
  if (/^\d{12}$/.test(code)) candidates.push(`0${code}`);
  if (/^0\d{12}$/.test(code)) candidates.push(code.slice(1));
  for (const c of candidates) {
    const product = index.byBarcode.get(c);
    if (product) return product;
  }
  for (const c of candidates) {
    const product = index.bySku.get(c);
    if (product) return product;
  }
  return null;
}
