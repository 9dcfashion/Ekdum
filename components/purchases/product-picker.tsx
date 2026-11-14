"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Package, PackagePlus, Plus, ReceiptText, ScanBarcode, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchPurchaseProductsAction, suggestPurchaseProductsAction } from "@/app/app/(shell)/purchases/actions";
import { formatINR, formatQty } from "@/lib/money";
import type { ProductSearchResult, ProductSuggestions, PurchaseProductOption } from "@/lib/purchases/types";
import { cn } from "@/lib/utils";
import { BarcodeScannerDialog, useBarcodeScanSupport, type ScanOutcome } from "./barcode-scanner";
import { callAction } from "./form-helpers";

/**
 * Add items to a purchase bill by tapping. Before anything is typed it lists
 * what was bought from this supplier last time (or recently from anyone).
 * Typing searches name, SKU or barcode; a keyboard barcode scanner types the
 * code and presses Enter, which adds the item straight away. Phones that can
 * read barcodes with the camera get a Scan button.
 */
export function ProductPicker({
  vendorId,
  vendorName,
  outletId,
  inBill,
  onPick,
  onCreate,
  onAddExpense,
}: {
  vendorId: string;
  vendorName: string | null;
  outletId: string;
  /** Quantity already on the bill, by product id. */
  inBill: Record<string, string>;
  /** `scanned` is true when the item came from the camera scanner. */
  onPick: (product: PurchaseProductOption, scanned?: boolean) => string | void;
  /** Present only when the user may create products. */
  onCreate?: (typedName: string) => void;
  onAddExpense: (typedName: string) => void;
}) {
  const listId = useId();
  const canScan = useBarcodeScanSupport();
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; data: ProductSearchResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggested, setSuggested] = useState<{ key: string; data: ProductSuggestions } | null>(null);
  const [active, setActive] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Suggestions follow the supplier and the outlet (stock is per outlet).
  const suggestKey = `${vendorId}|${outletId}`;
  useEffect(() => {
    let cancelled = false;
    callAction(() => suggestPurchaseProductsAction({ vendor_id: vendorId, outlet_id: outletId })).then((result) => {
      if (!cancelled && result.ok) setSuggested({ key: `${vendorId}|${outletId}`, data: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [vendorId, outletId]);

  async function search(text: string): Promise<ProductSearchResult | null> {
    const ticket = ++latest.current;
    setLoading(true);
    const result = await callAction(() => searchPurchaseProductsAction({ q: text, outlet_id: outletId }));
    if (ticket !== latest.current) return null; // a newer search has started
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setFound({ q: text, data: result.data });
    return result.data;
  }

  function reset(focus = true) {
    latest.current++;
    if (timer.current) clearTimeout(timer.current);
    setQ("");
    setFound(null);
    setLoading(false);
    setActive(-1);
    if (focus) inputRef.current?.focus();
  }

  function pick(product: PurchaseProductOption) {
    onPick(product);
    reset(false);
  }

  function onType(next: string) {
    setQ(next);
    setActive(-1);
    if (timer.current) clearTimeout(timer.current);
    const text = next.trim();
    if (!text) {
      latest.current++;
      setFound(null);
      setLoading(false);
      return;
    }
    timer.current = setTimeout(() => void search(text), 250);
  }

  async function onEnter() {
    const text = q.trim();
    if (!text) return;
    if (timer.current) clearTimeout(timer.current);
    const data = found?.q === text && !loading ? found.data : await search(text);
    if (!data) return;
    const highlighted = active >= 0 ? data.results[active] : undefined;
    const exact = data.exactId ? data.results.find((r) => r.id === data.exactId) : undefined;
    const only = data.results.length === 1 ? data.results[0] : undefined;
    const product = highlighted ?? exact ?? only;
    if (product) {
      onPick(product);
      reset();
    } else if (data.results.length === 0) toast.error(`No item found for "${text}"`);
  }

  async function scanned(code: string): Promise<ScanOutcome> {
    const result = await callAction(() => searchPurchaseProductsAction({ q: code, outlet_id: outletId }));
    if (!result.ok) return { ok: false, message: result.error };
    const product = result.data.exactId ? result.data.results.find((r) => r.id === result.data.exactId) : undefined;
    if (!product) return { ok: false, message: `No item has the code ${code}. Close this and add it with New item.` };
    const message = onPick(product, true);
    return { ok: true, message: message || `Added ${product.name}` };
  }

  const text = q.trim();
  const results = text ? (found && found.q === text ? found.data.results : null) : null;
  const suggestions = suggested && suggested.key === suggestKey ? suggested.data : null;
  const rows = text ? (results ?? []) : (suggestions?.results ?? []);
  const heading = text
    ? null
    : suggestions && suggestions.results.length > 0
      ? suggestions.source === "vendor" && vendorName
        ? `Bought from ${vendorName} before`
        : "Bought recently"
      : null;

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onEnter();
              } else if (e.key === "ArrowDown" && results) {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp" && results) {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Escape" && q) {
                e.preventDefault();
                reset();
              }
            }}
            placeholder="Search item name or code"
            aria-label="Search items to add"
            autoComplete="off"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 && results?.[active] ? `${listId}-${active}` : undefined}
            className="h-12 pr-10 pl-10 text-base"
            data-item-search
          />
          {loading ? <Loader2 className="absolute top-1/2 right-3 size-5 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>
        {canScan ? (
          <Button type="button" variant="outline" className="h-12 shrink-0 px-3 text-base" onClick={() => setScanning(true)}>
            <ScanBarcode className="size-5" aria-hidden /> Scan
          </Button>
        ) : null}
      </div>

      <div className="mt-3" aria-live="polite">
        {heading ? <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{heading}</p> : null}
        {rows.length > 0 ? (
          <ul id={listId} role="listbox" aria-label="Items" className="divide-y overflow-hidden rounded-xl border">
            {rows.map((p, i) => {
              const qty = inBill[p.id];
              return (
                <li key={p.id}>
                  <button
                    id={`${listId}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={text ? i === active : false}
                    tabIndex={-1}
                    onClick={() => pick(p)}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted active:bg-muted",
                      text && i === active && "bg-muted",
                    )}
                  >
                    <Package className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-base font-medium">{p.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {[
                          p.cost_paise !== null ? `Last rate ${formatINR(p.cost_paise)}` : null,
                          p.stock !== null ? `Stock ${formatQty(p.stock)} ${p.unit_code}` : null,
                          `GST ${p.gst_rate}%`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {qty ? (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Added {formatQty(qty)}</span>
                    ) : (
                      <Plus className="size-5 shrink-0 text-primary" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : text && results ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-base text-muted-foreground">No item matches &quot;{text}&quot;.</p>
        ) : text ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Searching</p>
        ) : null}
      </div>

      <div className={cn("mt-3 grid gap-2", onCreate && "grid-cols-2")}>
        {onCreate ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 border-dashed px-2 text-base"
            onClick={() => {
              onCreate(text);
              reset(false);
            }}
          >
            <PackagePlus className="size-5" aria-hidden /> New item
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-12 border-dashed px-2 text-base"
          onClick={() => {
            onAddExpense(text);
            reset(false);
          }}
        >
          <ReceiptText className="size-5" aria-hidden /> Other expense
        </Button>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">Other expense: freight, packing or anything that is not stock.</p>

      {canScan ? <BarcodeScannerDialog open={scanning} onClose={() => setScanning(false)} onCode={scanned} /> : null}
    </div>
  );
}
