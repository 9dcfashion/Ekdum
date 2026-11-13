"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, PackagePlus, PencilLine, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchPurchaseProductsAction } from "@/app/app/(shell)/purchases/actions";
import { formatINR } from "@/lib/money";
import type { ProductSearchResult, PurchaseProductOption } from "@/lib/purchases/types";
import { callAction } from "./form-helpers";

/**
 * "Add item" box for a purchase bill: type a name, SKU or barcode. A barcode
 * scanner types the code and presses Enter, which adds the product straight away.
 */
export function ProductPicker({
  onPick,
  onCreate,
  onAddFreeText,
}: {
  onPick: (product: PurchaseProductOption) => void;
  /** Present only when the user may create products. */
  onCreate?: (typedName: string) => void;
  onAddFreeText: (typedName: string) => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; data: ProductSearchResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function search(text: string): Promise<ProductSearchResult | null> {
    const ticket = ++latest.current;
    setLoading(true);
    const result = await callAction(() => searchPurchaseProductsAction({ q: text }));
    if (ticket !== latest.current) return null; // a newer search has started
    setLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setFound({ q: text, data: result.data });
    return result.data;
  }

  function reset() {
    latest.current++;
    if (timer.current) clearTimeout(timer.current);
    setQ("");
    setFound(null);
    setLoading(false);
    inputRef.current?.focus();
  }

  function pick(product: PurchaseProductOption) {
    onPick(product);
    reset();
  }

  function onType(next: string) {
    setQ(next);
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
    const exact = data.exactId ? data.results.find((r) => r.id === data.exactId) : undefined;
    const only = data.results.length === 1 ? data.results[0] : undefined;
    const product = exact ?? only;
    if (product) pick(product);
    else if (data.results.length === 0) toast.error(`No product found for "${text}"`);
  }

  const text = q.trim();
  const results = found && found.q === text ? found.data.results : null;

  return (
    <div>
      <div className="relative">
        <ScanBarcode className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onEnter();
            } else if (e.key === "Escape" && q) {
              e.preventDefault();
              reset();
            }
          }}
          placeholder="Add item: type a name or SKU, or scan a barcode"
          aria-label="Search products to add"
          autoComplete="off"
          enterKeyHint="search"
          className="pr-8 pl-8"
        />
        {loading ? <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>

      {text ? (
        <div className="mt-1.5 rounded-lg border" aria-live="polite">
          {results && results.length > 0 ? (
            <ul className="max-h-64 divide-y overflow-y-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[p.sku ? `SKU ${p.sku}` : null, p.barcode, p.unit_code, `GST ${p.gst_rate}%`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {p.cost_paise !== null ? (
                      <span className="tabular shrink-0 text-xs text-muted-foreground">Last cost {formatINR(p.cost_paise)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : results ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No product matches &quot;{text}&quot;.</p>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">Searching</p>
          )}
          <div className="flex flex-wrap gap-1.5 border-t bg-muted/40 p-1.5">
            {onCreate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onCreate(text);
                  reset();
                }}
              >
                <PackagePlus aria-hidden /> Create product
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onAddFreeText(text);
                reset();
              }}
            >
              <PencilLine aria-hidden /> Add as expense line (no stock)
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
