"use client";

import Link from "next/link";
import { Minus, Plus, ScanBarcode, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatRate } from "@/lib/gst";
import { formatINR, formatQty, paiseToRupees, rupeesToPaise } from "@/lib/money";
import { exceedsStock, lineDiscountPaise, lineGrossPaise } from "@/lib/pos/cart";
import type { CartLine, CartState, Discount, PosContext } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import { CommitInput } from "./commit-input";

export const lineElementId = (key: string) => `pos-line-${key}`;

export interface CartLineHandlers {
  onSelect: (key: string) => void;
  onSetQuantity: (key: string, quantity: string) => boolean;
  onChangeQuantity: (key: string, delta: number) => void;
  onSetPrice: (key: string, paise: number) => boolean;
  onSetDiscount: (key: string, discount: Discount) => boolean;
  onRemove: (key: string) => void;
  onInvalid: (message: string) => void;
  focusSearch: () => void;
}

/** "50" → ₹50, "5%" → 5 percent, "" → no discount. Null when it is not a number. */
export function parseDiscountInput(text: string, kind: Discount["kind"]): Discount | null {
  const raw = text.trim();
  if (raw === "") return kind === "amount" ? { kind, paise: 0 } : { kind, percent: 0 };
  if (raw.endsWith("%") || kind === "percent") {
    const percent = Number(raw.replace(/%$/, "").trim());
    return raw.replace(/%$/, "").trim() !== "" && Number.isFinite(percent) && percent >= 0
      ? { kind: "percent", percent: Math.round(percent * 100) / 100 }
      : null;
  }
  const paise = rupeesToPaise(raw);
  return paise !== null && paise >= 0 ? { kind: "amount", paise } : null;
}

export function discountInputValue(discount: Discount): string {
  if (discount.kind === "amount") return discount.paise > 0 ? paiseToRupees(discount.paise) : "";
  return discount.percent > 0 ? String(discount.percent) : "";
}

/** Amount / percent switch that sits next to a discount field. */
export function DiscountKindToggle({
  kind,
  onChange,
  label,
  className,
}: {
  kind: Discount["kind"];
  onChange: (kind: Discount["kind"]) => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`${label}: switch to ${kind === "amount" ? "percent" : "rupees"}`}
      title={kind === "amount" ? "Discount in rupees. Tap for percent." : "Discount in percent. Tap for rupees."}
      onClick={() => onChange(kind === "amount" ? "percent" : "amount")}
      className={cn(
        "h-8 w-8 shrink-0 rounded-lg border border-input bg-muted/50 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {kind === "amount" ? "₹" : "%"}
    </button>
  );
}

function Line({
  line,
  position,
  selected,
  ctx,
  handlers,
}: {
  line: CartLine;
  position: number;
  selected: boolean;
  ctx: PosContext;
  handlers: CartLineHandlers;
}) {
  const key = line.key;
  const gross = lineGrossPaise(line);
  const discount = lineDiscountPaise(line);
  const overStock = exceedsStock(line);
  const manual = line.productId === null;
  const overridden = !manual && line.unitPricePaise !== line.listPricePaise;
  const canEditPrice = ctx.canOverridePrice || manual;

  function focusSibling(direction: 1 | -1, from: HTMLElement) {
    const sibling = (direction === 1 ? from.nextElementSibling : from.previousElementSibling) as HTMLElement | null;
    if (sibling?.dataset.cartLine) sibling.focus();
    else if (direction === -1) handlers.focusSearch();
  }

  return (
    <div
      id={lineElementId(key)}
      data-cart-line="true"
      role="row"
      tabIndex={0}
      aria-label={`${line.name}, quantity ${formatQty(line.quantity)}`}
      aria-selected={selected}
      onFocus={() => handlers.onSelect(key)}
      onKeyDown={(e) => {
        // Keys typed inside the quantity, price or discount fields belong to those fields.
        if (e.target !== e.currentTarget) return;
        const row = e.currentTarget;
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          handlers.onChangeQuantity(key, 1);
        } else if (e.key === "-") {
          e.preventDefault();
          handlers.onChangeQuantity(key, -1);
        } else if (e.key === "Delete") {
          e.preventDefault();
          const next = (row.nextElementSibling ?? row.previousElementSibling) as HTMLElement | null;
          handlers.onRemove(key);
          if (next?.dataset.cartLine) next.focus();
          else handlers.focusSearch();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          focusSibling(1, row);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          focusSibling(-1, row);
        } else if (e.key === "Enter") {
          e.preventDefault();
          row.querySelector<HTMLInputElement>("input[data-qty]")?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          handlers.focusSearch();
        }
      }}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset lg:flex-nowrap",
        selected ? "bg-primary/5" : "bg-background",
      )}
    >
      <div className="flex min-w-0 basis-full items-start gap-2 lg:basis-0 lg:flex-1" role="cell">
        <span className="tabular mt-0.5 w-5 shrink-0 text-xs text-muted-foreground">{position}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{line.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {manual ? <StatusBadge tone="indigo" label="Not in product list" /> : null}
            {line.sku ? <span className="truncate">{line.sku}</span> : null}
            <span>GST {formatRate(line.gstRate)}{line.priceIncludesTax ? " incl." : " extra"}</span>
            {overStock ? (
              <StatusBadge
                tone={ctx.allowNegativeStock ? "amber" : "red"}
                label={(line.stock ?? 0) > 0 ? `Only ${formatQty(line.stock)} in stock` : "Out of stock"}
              />
            ) : null}
            {overridden ? <StatusBadge tone="blue" label={`Price changed from ${formatINR(line.listPricePaise)}`} /> : null}
          </div>
        </div>
        <button
          type="button"
          aria-label={`Remove ${line.name}`}
          onClick={() => {
            handlers.onRemove(key);
            handlers.focusSearch();
          }}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 lg:hidden"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="flex w-32 shrink-0 items-center gap-1" role="cell">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease quantity of ${line.name}`}
          onClick={() => handlers.onChangeQuantity(key, -1)}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-input bg-background outline-none hover:bg-muted"
        >
          <Minus className="size-3.5" />
        </button>
        <CommitInput
          data-qty="true"
          aria-label={`Quantity of ${line.name} in ${line.unitCode}`}
          inputMode={line.allowDecimal ? "decimal" : "numeric"}
          value={line.quantity}
          onCommit={(v) => handlers.onSetQuantity(key, v)}
          onDone={handlers.focusSearch}
          className="text-center"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase quantity of ${line.name}`}
          onClick={() => handlers.onChangeQuantity(key, 1)}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-input bg-background outline-none hover:bg-muted"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <div className="w-24 shrink-0" role="cell">
        {canEditPrice ? (
          <CommitInput
            aria-label={`Price of ${line.name}`}
            inputMode="decimal"
            value={paiseToRupees(line.unitPricePaise)}
            onCommit={(v) => {
              const paise = rupeesToPaise(v);
              if (paise === null || paise < 0) {
                handlers.onInvalid("Enter a valid price");
                return false;
              }
              return handlers.onSetPrice(key, paise);
            }}
            onDone={handlers.focusSearch}
          />
        ) : (
          <p className="tabular px-2 text-right text-sm" title="Your role cannot change prices">
            {formatINR(line.unitPricePaise, { symbol: false })}
          </p>
        )}
      </div>

      {ctx.canDiscount ? (
        <div className="flex w-28 shrink-0 items-center gap-1" role="cell">
          <CommitInput
            aria-label={`Discount on ${line.name} in ${line.discount.kind === "amount" ? "rupees" : "percent"}`}
            inputMode="decimal"
            placeholder="0"
            value={discountInputValue(line.discount)}
            onCommit={(v) => {
              const parsed = parseDiscountInput(v, line.discount.kind);
              if (!parsed) {
                handlers.onInvalid("Enter a valid discount");
                return false;
              }
              return handlers.onSetDiscount(key, parsed);
            }}
            onDone={handlers.focusSearch}
          />
          <DiscountKindToggle
            kind={line.discount.kind}
            label={`Discount on ${line.name}`}
            onChange={(kind) => handlers.onSetDiscount(key, kind === "amount" ? { kind, paise: 0 } : { kind, percent: 0 })}
          />
        </div>
      ) : null}

      <div className="ml-auto w-24 shrink-0 text-right" role="cell">
        <p className="tabular text-sm font-semibold">{formatINR(gross - discount, { symbol: false })}</p>
        {discount > 0 ? <p className="tabular text-xs text-muted-foreground line-through">{formatINR(gross, { symbol: false })}</p> : null}
      </div>

      <button
        type="button"
        tabIndex={-1}
        aria-label={`Remove ${line.name}`}
        onClick={() => {
          handlers.onRemove(key);
          handlers.focusSearch();
        }}
        className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive lg:flex"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** The bill lines. Lives inside a fixed scroll area, so adding lines never moves the rest of the screen. */
export function CartLines({
  cart,
  ctx,
  selectedKey,
  handlers,
  nothingToSell = false,
}: {
  cart: CartState;
  ctx: PosContext;
  selectedKey: string | null;
  handlers: CartLineHandlers;
  /** No products and no quick items: point the owner to where they are set up. */
  nothingToSell?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background" role="table" aria-label="Bill items">
      <div
        role="row"
        className="hidden h-8 shrink-0 items-center gap-3 border-b bg-muted/50 px-3 text-xs font-medium text-muted-foreground lg:flex"
      >
        <span role="columnheader" className="min-w-0 flex-1 pl-7">Item</span>
        <span role="columnheader" className="w-32 shrink-0 text-center">Qty</span>
        <span role="columnheader" className="w-24 shrink-0 pr-2 text-right">Price</span>
        {ctx.canDiscount ? <span role="columnheader" className="w-28 shrink-0 text-center">Discount</span> : null}
        <span role="columnheader" className="w-24 shrink-0 text-right">Amount</span>
        <span className="w-8 shrink-0" aria-hidden />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="rowgroup">
        {cart.lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ScanBarcode className="size-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="font-medium">The bill is empty</p>
            {nothingToSell ? (
              <p className="max-w-sm text-sm text-muted-foreground">
                There are no products or quick items to bill yet. Add them in{" "}
                <Link href="/app/products" className="font-medium text-primary underline-offset-4 hover:underline">
                  Products
                </Link>{" "}
                or{" "}
                <Link href="/app/settings/quick-items" className="font-medium text-primary underline-offset-4 hover:underline">
                  Settings, Quick billing items
                </Link>
                . Until then, use Not in list (F6).
              </p>
            ) : (
              <p className="max-w-xs text-sm text-muted-foreground">Scan a barcode, or type a name or SKU in the box above and press Enter.</p>
            )}
          </div>
        ) : (
          cart.lines.map((line, i) => (
            <Line key={line.key} line={line} position={i + 1} selected={line.key === selectedKey} ctx={ctx} handlers={handlers} />
          ))
        )}
      </div>
    </div>
  );
}
