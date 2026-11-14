"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronUp, Loader2, PackagePlus, ReceiptText, RefreshCw, ScanBarcode, Search, Sparkles, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRate } from "@/lib/gst";
import { formatINR, formatQty } from "@/lib/money";
import type { CartSummary } from "@/lib/pos/cart";
import { sortByName, tileList } from "@/lib/pos/quick-bill";
import { filterQuickItems } from "@/lib/pos/quick-items";
import { resolveScan, type CatalogIndex } from "@/lib/pos/search";
import type { CartIssue, CartState, CatalogProduct, PosContext, PosSettings, QuickItem } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import { useCameraScanSupported, useStoredValue, writeStored } from "./use-quick-bill";

/** Tiles rendered at first and per "Show more": plenty for a phone, cheap even with thousands of products. */
const TILE_PAGE = 40;
const HINT_KEY = "ekdum.pos.quickbill.hint-dismissed";
const LOW_STOCK = 5;

const tileGrid = "grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4";

function ProductTile({
  product,
  stock,
  qty,
  showGstExtra,
  onTap,
}: {
  product: CatalogProduct;
  stock: number | null;
  qty: string | undefined;
  showGstExtra: boolean;
  onTap: () => void;
}) {
  const out = stock !== null && stock <= 0;
  const low = stock !== null && stock > 0 && stock <= LOW_STOCK;
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "relative flex min-h-24 min-w-0 flex-col justify-between gap-1.5 rounded-xl border bg-background p-3 text-left outline-none transition-[background-color,transform] focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] active:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100",
        qty ? "border-primary ring-1 ring-primary" : "border-border",
        out && "bg-muted/50",
      )}
    >
      <span className={cn("line-clamp-2 pr-8 text-[0.95rem] leading-snug font-medium [overflow-wrap:anywhere]", out && "text-muted-foreground")}>
        {product.name}
      </span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="tabular text-base font-semibold">
          {formatINR(product.sale_price_paise)}
          {showGstExtra && !product.price_includes_tax ? <span className="text-xs font-normal text-muted-foreground"> + GST</span> : null}
        </span>
        {stock !== null ? (
          <span className={cn("text-xs", out ? "font-semibold text-destructive" : low ? "font-medium text-amber-700" : "text-muted-foreground")}>
            {out ? "Out of stock" : `${formatQty(stock)} left`}
          </span>
        ) : null}
      </span>
      {qty ? (
        <span className="tabular absolute top-2 right-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-1.5 text-sm font-semibold text-primary-foreground">
          {formatQty(qty)}
          <span className="sr-only"> in the bill</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * The billing screen below the `lg` breakpoint (phones and small tablets):
 * a search box with camera scan, quick item buttons, product tiles (one tap
 * adds one) and a sticky bar with the bill total and Pay.
 */
export function QuickBill({
  index,
  catalog,
  cart,
  summary,
  issues,
  ctx,
  settings,
  recentIds,
  nothingToSell,
  stockOf,
  searchRef,
  parkedCount,
  posting,
  refreshing,
  onRefreshCatalog,
  onAddProduct,
  onOpenManual,
  onOpenQuickItem,
  onOpenScanner,
  onOpenBill,
  onOpenParked,
  onPay,
}: {
  index: CatalogIndex;
  catalog: CatalogProduct[];
  cart: CartState;
  summary: CartSummary;
  issues: CartIssue[];
  ctx: PosContext;
  settings: PosSettings;
  recentIds: string[];
  /** No products and no quick items set up yet: point the owner to where they are added. */
  nothingToSell: boolean;
  stockOf: (product: CatalogProduct) => number | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  parkedCount: number;
  posting: boolean;
  refreshing: boolean;
  onRefreshCatalog?: () => void;
  /** Adds one; shows the reason when it cannot (e.g. out of stock). Returns true when added. */
  onAddProduct: (product: CatalogProduct) => boolean;
  onOpenManual: (name: string) => void;
  onOpenQuickItem: (item: QuickItem) => void;
  onOpenScanner: () => void;
  onOpenBill: () => void;
  onOpenParked: () => void;
  onPay: () => void;
}) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState({ query: "", count: TILE_PAGE });
  const [announcement, setAnnouncement] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scanSupported = useCameraScanSupported();
  const hint = useStoredValue(HINT_KEY);

  const alphabetical = sortByName(catalog);
  const tiles = tileList(index, query, recentIds, alphabetical);
  const quickItems = filterQuickItems(settings.quickItems, query);
  const listKey = query.trim().toLowerCase();
  const count = shown.query === listKey ? shown.count : TILE_PAGE;
  const visible = tiles.items.slice(0, count);
  const recentVisible = visible.slice(0, tiles.recentCount);
  const restVisible = visible.slice(tiles.recentCount);
  const remaining = tiles.items.length - visible.length;

  const qtyInBill = new Map<string, string>();
  for (const line of cart.lines) if (line.productId) qtyInBill.set(line.productId, line.quantity);

  const chargesTax = ctx.gstScheme === "regular";
  const lineCount = cart.lines.length;
  const issue = lineCount > 0 ? issues[0] : undefined;
  const typed = query.trim();
  const noCatalog = catalog.length === 0;

  function announceAdded(product: CatalogProduct) {
    // The count changes on every tap, so a screen reader announces each one (the same text twice would be skipped).
    const after = Number(qtyInBill.get(product.id) ?? 0) + 1;
    setAnnouncement(`${product.name}: ${formatQty(after)} in the bill.`);
  }

  function tap(product: CatalogProduct) {
    if (onAddProduct(product)) announceAdded(product);
  }

  function type(text: string) {
    setQuery(text);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function onEnter(input: HTMLInputElement) {
    // A Bluetooth or USB scanner types the code and presses Enter, like on the desktop screen.
    if (!typed) return;
    const scan = resolveScan(index, typed, 30);
    if (scan.kind === "add") {
      if (onAddProduct(scan.product)) {
        announceAdded(scan.product);
        type("");
      }
      return;
    }
    if (scan.kind === "choose") return input.blur(); // hide the keyboard so the matching tiles show
    if (/^\d{6,}$/.test(typed)) {
      toast.error(`No item found for "${typed}"`);
      input.select();
      return;
    }
    const name = typed;
    type("");
    onOpenManual(name);
  }

  const notInList = (
    <button
      type="button"
      onClick={() => {
        const name = typed;
        if (name) type("");
        onOpenManual(name);
      }}
      className="flex min-h-24 min-w-0 flex-col justify-between gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-3 text-left text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-primary/10"
    >
      <PackagePlus className="size-6" aria-hidden />
      <span>
        <span className="block text-[0.95rem] leading-snug font-semibold">Not in list</span>
        <span className="block truncate text-xs text-primary/80">{typed ? `Bill "${typed}"` : "Type name and price"}</span>
      </span>
    </button>
  );

  return (
    <section aria-label="Make a bill" className="flex min-h-0 min-w-0 flex-1 flex-col lg:hidden">
      <div className="flex shrink-0 items-center gap-2 border-b bg-background p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            ref={searchRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Search items by name, SKU or barcode"
            placeholder="Search item"
            value={query}
            onFocus={(e) => e.target.select()}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onEnter(e.currentTarget);
              } else if (e.key === "Escape" && query) {
                // First Esc empties the box; the bill is untouched.
                e.preventDefault();
                e.stopPropagation();
                type("");
              }
            }}
            className="h-12 w-full rounded-xl border border-input bg-background pr-12 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => type("")}
              className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
        </div>
        {scanSupported ? (
          <Button type="button" variant="outline" className="h-12 gap-2 rounded-xl px-4 text-base" onClick={onOpenScanner}>
            <ScanBarcode className="size-5" aria-hidden /> Scan
          </Button>
        ) : null}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-6">
        {hint === null ? (
          <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p className="min-w-0 flex-1 text-base font-semibold">How to make a bill</p>
              <button
                type="button"
                aria-label="Hide these tips"
                onClick={() => writeStored(HINT_KEY, "1")}
                className="-mt-2.5 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ol className="mt-2 grid gap-2 text-base sm:grid-cols-3">
              {["Tap items", "Tap Pay", "Choose Cash, UPI or Card"].map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden>
                    {i + 1}
                  </span>
                  <span>
                    <span className="sr-only">Step {i + 1}: </span>
                    {step}
                  </span>
                </li>
              ))}
            </ol>
            <Button type="button" variant="outline" className="mt-3 h-11 w-full text-base" onClick={() => writeStored(HINT_KEY, "1")}>
              Got it
            </Button>
          </div>
        ) : null}

        {parkedCount > 0 ? (
          <button
            type="button"
            onClick={onOpenParked}
            className="mb-3 flex h-11 w-full items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 text-left text-base text-amber-900 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ReceiptText className="size-5 shrink-0" aria-hidden />
            <span className="flex-1">
              {parkedCount} held {parkedCount === 1 ? "bill" : "bills"}
            </span>
            <span className="text-sm font-medium">Open</span>
          </button>
        ) : null}

        {quickItems.length > 0 ? (
          <section aria-labelledby="pos-quick-items" className="mb-3">
            <h2 id="pos-quick-items" className="mb-1.5 flex items-center gap-1.5 px-1 text-sm font-semibold text-muted-foreground">
              <Zap className="size-4" aria-hidden /> Quick items
            </h2>
            <div className={tileGrid}>
              {quickItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onOpenQuickItem(item)}
                  className="flex min-h-16 min-w-0 flex-col justify-center gap-0.5 rounded-xl border-2 border-primary/30 bg-background px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-primary/10"
                >
                  <span className="line-clamp-2 text-base leading-snug font-semibold [overflow-wrap:anywhere]">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{chargesTax ? `GST ${formatRate(item.gstRate)} · type rate` : "Type rate"}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-label="Items">
          {tiles.recentCount > 0 ? <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted-foreground">Recent</h2> : null}
          {typed && !noCatalog ? (
            <p className="mb-1.5 px-1 text-sm text-muted-foreground" aria-live="polite">
              {tiles.items.length === 0 ? `No items match "${typed}".` : `${tiles.items.length} ${tiles.items.length === 1 ? "item" : "items"} found`}
            </p>
          ) : null}
          <div className={tileGrid}>
            {notInList}
            {(tiles.recentCount > 0 ? recentVisible : restVisible).map((p) => (
              <ProductTile key={p.id} product={p} stock={stockOf(p)} qty={qtyInBill.get(p.id)} showGstExtra={chargesTax} onTap={() => tap(p)} />
            ))}
          </div>
          {tiles.recentCount > 0 && restVisible.length > 0 ? (
            <>
              <h2 className="mt-4 mb-1.5 px-1 text-sm font-semibold text-muted-foreground">All items</h2>
              <div className={tileGrid}>
                {restVisible.map((p) => (
                  <ProductTile key={p.id} product={p} stock={stockOf(p)} qty={qtyInBill.get(p.id)} showGstExtra={chargesTax} onTap={() => tap(p)} />
                ))}
              </div>
            </>
          ) : null}
        </section>

        {remaining > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-12 w-full text-base"
            onClick={() => setShown({ query: listKey, count: count + TILE_PAGE })}
          >
            Show more ({remaining} more)
          </Button>
        ) : null}

        {typed && tiles.items.length === 0 && !noCatalog ? (
          <p className="mt-3 px-1 text-sm text-muted-foreground">Check the spelling, try the barcode number, or tap Not in list.</p>
        ) : null}

        {nothingToSell ? (
          <div className="mt-3 grid gap-2 rounded-xl border bg-background p-4 text-center">
            <p className="text-base font-semibold">No items to tap yet</p>
            <p className="text-sm text-muted-foreground">
              Add your products, or set up quick billing items (like Necklace or Ring) so staff can bill in one tap. Until then, use Not in list.
            </p>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <Button asChild variant="outline" className="h-11 text-base">
                <Link href="/app/products">Products</Link>
              </Button>
              <Button asChild variant="outline" className="h-11 text-base">
                <Link href="/app/settings/quick-items">Quick billing items</Link>
              </Button>
            </div>
          </div>
        ) : null}

        {onRefreshCatalog ? (
          <Button type="button" variant="ghost" className="mt-4 h-11 w-full text-sm text-muted-foreground" onClick={onRefreshCatalog} disabled={refreshing}>
            {refreshing ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RefreshCw aria-hidden />}
            Refresh items and prices
          </Button>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>

      {/* Sticky bill bar. It sits below the scroll area (not over it), so it never hides a tile. */}
      <div className="shrink-0 border-t bg-background px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenBill}
            aria-label={lineCount === 0 ? "Open the bill. No items yet." : `Open the bill: ${lineCount} ${lineCount === 1 ? "item" : "items"}, ${formatINR(summary.totals.totalPaise)}`}
            className="flex h-14 min-w-0 flex-1 items-center gap-2 rounded-xl border bg-muted/40 px-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm", issue ? "text-destructive" : "text-muted-foreground")}>
                {issue ? issue.message : lineCount === 0 ? "No items yet" : `${lineCount} ${lineCount === 1 ? "item" : "items"} · View bill`}
              </span>
              <span className="tabular block truncate text-xl leading-tight font-bold">{formatINR(summary.totals.totalPaise)}</span>
            </span>
            <ChevronUp className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
          <Button type="button" size="lg" className="h-14 min-w-28 rounded-xl px-6 text-lg" disabled={lineCount === 0 || posting} onClick={onPay}>
            Pay
          </Button>
        </div>
      </div>
    </section>
  );
}
