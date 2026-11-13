/**
 * In-memory product search for the POS. Pure and fast enough for a few
 * thousand products: the catalog is indexed once, each search is one pass.
 */
import type { CatalogProduct } from "./types";

interface IndexedProduct {
  product: CatalogProduct;
  name: string;
  sku: string;
  barcode: string;
}

export interface CatalogIndex {
  items: IndexedProduct[];
  byId: Map<string, CatalogProduct>;
  byBarcode: Map<string, CatalogProduct>;
  bySku: Map<string, CatalogProduct>;
}

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function buildCatalogIndex(catalog: CatalogProduct[]): CatalogIndex {
  const index: CatalogIndex = { items: [], byId: new Map(), byBarcode: new Map(), bySku: new Map() };
  for (const product of catalog) {
    const item = { product, name: norm(product.name), sku: norm(product.sku), barcode: norm(product.barcode) };
    index.items.push(item);
    index.byId.set(product.id, product);
    if (item.barcode && !index.byBarcode.has(item.barcode)) index.byBarcode.set(item.barcode, product);
    if (item.sku && !index.bySku.has(item.sku)) index.bySku.set(item.sku, product);
  }
  return index;
}

/** Lower is better. Null = no match. Every word of the query must match somewhere. */
function score(item: IndexedProduct, query: string, words: string[]): number | null {
  if (item.barcode === query || item.sku === query) return 0;
  if (item.name === query) return 1;
  if (item.name.startsWith(query)) return 2;
  if (item.sku.startsWith(query) || item.barcode.startsWith(query)) return 3;
  let worst = 4;
  for (const word of words) {
    const at = item.name.indexOf(word);
    if (at === 0 || (at > 0 && item.name[at - 1] === " ")) continue;
    if (at > 0) worst = Math.max(worst, 5);
    else if (item.sku.includes(word) || item.barcode.includes(word)) worst = Math.max(worst, 6);
    else return null;
  }
  return worst;
}

/** Products matching name, SKU or barcode, best matches first, at most `limit`. */
export function searchCatalog(index: CatalogIndex, query: string, limit = 30): CatalogProduct[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits: Array<{ product: CatalogProduct; rank: number }> = [];
  for (const item of index.items) {
    const rank = score(item, q, words);
    if (rank !== null) hits.push({ product: item.product, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || a.product.name.localeCompare(b.product.name));
  return hits.slice(0, limit).map((h) => h.product);
}

export type ScanResult =
  | { kind: "add"; product: CatalogProduct; via: "barcode" | "sku" | "single" }
  | { kind: "choose"; results: CatalogProduct[] }
  | { kind: "none" };

/**
 * What Enter in the search box does (a barcode scanner types the code and sends Enter):
 * exact barcode → add; else exact SKU → add; else the only search result → add;
 * else show the list.
 */
export function resolveScan(index: CatalogIndex, query: string, limit = 30): ScanResult {
  const q = norm(query);
  if (!q) return { kind: "none" };
  const byBarcode = index.byBarcode.get(q);
  if (byBarcode) return { kind: "add", product: byBarcode, via: "barcode" };
  const bySku = index.bySku.get(q);
  if (bySku) return { kind: "add", product: bySku, via: "sku" };
  const results = searchCatalog(index, q, limit);
  if (results.length === 1) return { kind: "add", product: results[0], via: "single" };
  return results.length === 0 ? { kind: "none" } : { kind: "choose", results };
}
