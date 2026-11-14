"use client";

import { useState } from "react";
import { PackagePlus, ScanBarcode, X } from "lucide-react";
import { toast } from "sonner";
import { formatINR, formatQty } from "@/lib/money";
import { resolveScan, searchCatalog, type CatalogIndex } from "@/lib/pos/search";
import type { CatalogProduct } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import { Kbd } from "./shortcut-legend";

const MAX_RESULTS = 30;

/**
 * The search / scan box. A barcode scanner types the code here and sends Enter.
 * Results float over the cart, so opening them never moves the layout.
 */
export function ProductSearch({
  index,
  inputRef,
  stockOf,
  onAdd,
  onMoveToCart,
  onAdjustSelected,
  onAddManual,
}: {
  index: CatalogIndex;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Stock left at this outlet, or null when unknown / not tracked. */
  stockOf: (product: CatalogProduct) => number | null;
  /** Returns true when the item went into the bill. */
  onAdd: (product: CatalogProduct) => boolean;
  /** Arrow down in an empty box moves to the bill lines. */
  onMoveToCart: () => void;
  /** Plus / minus in an empty box change the selected line. */
  onAdjustSelected: (delta: number) => void;
  /** Bill something that is not in the product list, prefilled with what was typed. */
  onAddManual: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  /** -1 until the cashier presses an arrow key or Enter opens the list. */
  const [highlight, setHighlight] = useState(-1);
  const [closed, setClosed] = useState(false);

  const results = query.trim() ? searchCatalog(index, query, MAX_RESULTS) : [];
  const open = !closed && query.trim().length > 0;

  function reset() {
    setQuery("");
    setHighlight(-1);
    setClosed(false);
  }

  function add(product: CatalogProduct) {
    if (onAdd(product)) reset();
    else inputRef.current?.select();
    inputRef.current?.focus();
  }

  function onEnter() {
    if (!query.trim()) return;
    if (open && highlight >= 0 && results[highlight]) return add(results[highlight]);
    const scan = resolveScan(index, query, MAX_RESULTS);
    if (scan.kind === "add") return add(scan.product);
    if (scan.kind === "choose") {
      setClosed(false);
      setHighlight(0);
      return;
    }
    // Nothing matched: offer to bill it as a manual item. A barcode-looking string is more likely a scan of an unknown code.
    if (/^\d{6,}$/.test(query.trim())) {
      toast.error(`No item found for "${query.trim()}"`);
      inputRef.current?.select();
      return;
    }
    addManual();
  }

  function addManual() {
    const name = query;
    reset();
    onAddManual(name);
  }

  function move(delta: number) {
    if (results.length === 0) return;
    setClosed(false);
    const next = highlight < 0 ? (delta > 0 ? 0 : results.length - 1) : (highlight + delta + results.length) % results.length;
    setHighlight(next);
    document.getElementById(`pos-result-${next}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="relative">
      <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-label="Search or scan an item"
        aria-expanded={open}
        aria-controls="pos-results"
        aria-activedescendant={open && highlight >= 0 ? `pos-result-${highlight}` : undefined}
        placeholder="Scan a barcode or search by name or SKU"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(-1);
          setClosed(false);
        }}
        onFocus={() => setClosed(false)}
        onBlur={() => setClosed(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (query.trim()) move(1);
            else onMoveToCart();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Escape" && query) {
            // First Esc closes the list and empties the box; the bill is untouched.
            e.preventDefault();
            e.stopPropagation();
            reset();
          } else if (!query && (e.key === "+" || e.key === "=" || e.key === "-")) {
            e.preventDefault();
            onAdjustSelected(e.key === "-" ? -1 : 1);
          }
        }}
        className="h-11 w-full rounded-lg border border-input bg-background pr-16 pl-10 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            // Keep focus in the search box.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              reset();
              inputRef.current?.focus();
            }}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : (
          <Kbd>F2</Kbd>
        )}
      </div>

      {open ? (
        <div
          id="pos-results"
          role="listbox"
          aria-label="Matching items"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(24rem,60dvh)] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {results.length === 0 ? (
            <div className="grid gap-2 px-3 py-3 text-center">
              <p className="text-sm text-muted-foreground">No items match. Check the spelling or scan again.</p>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={addManual}
                className="mx-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-dashed px-3 text-sm font-medium text-primary hover:bg-primary/5"
              >
                <PackagePlus className="size-4" aria-hidden /> Add “{query.trim()}” as an item not in your list
              </button>
            </div>
          ) : (
            results.map((p, i) => {
              const stock = stockOf(p);
              return (
                <button
                  key={p.id}
                  id={`pos-result-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(p)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted",
                    i === highlight && "bg-muted",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[p.sku, p.barcode].filter(Boolean).join(" · ") || p.unit_code}
                    </span>
                  </span>
                  {stock !== null ? (
                    <span className={cn("tabular shrink-0 text-xs", stock <= 0 ? "text-destructive" : "text-muted-foreground")}>
                      {stock <= 0 ? "Out of stock" : `${formatQty(stock)} ${p.unit_code}`}
                    </span>
                  ) : null}
                  <span className="tabular w-24 shrink-0 text-right font-medium">{formatINR(p.sale_price_paise)}</span>
                </button>
              );
            })
          )}
          {results.length === MAX_RESULTS ? (
            <p className="px-3 py-1.5 text-center text-xs text-muted-foreground">Showing the first {MAX_RESULTS}. Type more to narrow down.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
