"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Minus, PauseCircle, Percent, Plus, ReceiptText, ShoppingBasket, Trash2, UserRound, X } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatMobile, formatRate } from "@/lib/gst";
import { Decimal, formatINR, formatQty, paiseToRupees, rupeesToPaise } from "@/lib/money";
import { exceedsStock, isDiscountSet, lineDiscountPaise, lineGrossPaise, type CartSummary } from "@/lib/pos/cart";
import type { CartIssue, CartLine, CartState, Discount, PosContext } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import { DiscountKindToggle, discountInputValue, parseDiscountInput } from "./cart-lines";
import { CommitInput } from "./commit-input";
import { useKeyboardInset } from "./use-quick-bill";

export interface BillSheetHandlers {
  onChangeQuantity: (key: string, delta: number) => void;
  onSetQuantity: (key: string, quantity: string) => boolean;
  onSetPrice: (key: string, paise: number) => boolean;
  onSetDiscount: (key: string, discount: Discount) => boolean;
  /** Removes at once; the screen shows an "Undo" toast. */
  onRemove: (key: string) => void;
  onInvalid: (message: string) => void;
}

const bigInput = "h-12 rounded-xl text-lg md:text-lg";

function LineCard({ line, ctx, handlers }: { line: CartLine; ctx: PosContext; handlers: BillSheetHandlers }) {
  const [more, setMore] = useState(false);
  const key = line.key;
  const gross = lineGrossPaise(line);
  const discount = lineDiscountPaise(line);
  const manual = line.productId === null;
  const overStock = exceedsStock(line);
  const overridden = !manual && line.unitPricePaise !== line.listPricePaise;
  const canEditPrice = ctx.canOverridePrice || manual;
  const hasMore = canEditPrice || ctx.canDiscount;
  // At one (or less) the minus button removes the item, with Undo.
  const minusRemoves = new Decimal(line.quantity).minus(1).lessThanOrEqualTo(0);
  const moreId = `pos-line-more-${key}`;

  return (
    <li className="rounded-xl border bg-background p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-base leading-snug font-medium [overflow-wrap:anywhere]">{line.name}</p>
          <p className="tabular mt-0.5 text-sm text-muted-foreground">
            {formatINR(line.unitPricePaise)} each{line.unitCode !== "PCS" ? ` (per ${line.unitCode})` : ""}
          </p>
          {manual || overStock || overridden ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {manual ? <StatusBadge tone="indigo" label="Not in list" /> : null}
              {overStock ? (
                <StatusBadge
                  tone={ctx.allowNegativeStock ? "amber" : "red"}
                  label={(line.stock ?? 0) > 0 ? `Only ${formatQty(line.stock)} in stock` : "Out of stock"}
                />
              ) : null}
              {overridden ? <StatusBadge tone="blue" label={`Price changed from ${formatINR(line.listPricePaise)}`} /> : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={`Remove ${line.name}`}
          onClick={() => handlers.onRemove(key)}
          className="-mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Trash2 className="size-5" aria-hidden />
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-label={minusRemoves ? `Remove ${line.name}` : `One less ${line.name}`}
          onClick={() => (minusRemoves ? handlers.onRemove(key) : handlers.onChangeQuantity(key, -1))}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-input bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {minusRemoves ? <Trash2 className="size-5 text-destructive" aria-hidden /> : <Minus className="size-5" aria-hidden />}
        </button>
        <CommitInput
          aria-label={`Quantity of ${line.name} in ${line.unitCode}`}
          inputMode={line.allowDecimal ? "decimal" : "numeric"}
          enterKeyHint="done"
          value={line.quantity}
          onCommit={(v) => handlers.onSetQuantity(key, v)}
          className={cn(bigInput, "w-16 shrink-0 text-center font-semibold")}
        />
        <button
          type="button"
          aria-label={`One more ${line.name}`}
          onClick={() => handlers.onChangeQuantity(key, 1)}
          className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-input bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-5" aria-hidden />
        </button>
        <div className="ml-auto min-w-0 text-right">
          <p className="tabular truncate text-lg font-semibold">{formatINR(gross - discount)}</p>
          {discount > 0 ? <p className="tabular truncate text-sm text-muted-foreground line-through">{formatINR(gross)}</p> : null}
        </div>
      </div>

      {hasMore ? (
        <>
          <button
            type="button"
            aria-expanded={more}
            aria-controls={moreId}
            onClick={() => setMore(!more)}
            className="mt-2 inline-flex h-11 items-center gap-1 rounded-lg px-1 text-sm font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {more ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
            {canEditPrice && ctx.canDiscount ? "Change price or discount" : canEditPrice ? "Change price" : "Give discount"}
          </button>
          {more ? (
            <div id={moreId} className="mt-1 grid gap-3 border-t pt-3">
              {canEditPrice ? (
                <div className="grid gap-1.5">
                  <label htmlFor={`${moreId}-price`} className="text-sm font-medium">
                    Price for one (₹)
                  </label>
                  <CommitInput
                    id={`${moreId}-price`}
                    inputMode="decimal"
                    enterKeyHint="done"
                    value={paiseToRupees(line.unitPricePaise)}
                    onCommit={(v) => {
                      const paise = rupeesToPaise(v);
                      if (paise === null || paise < 0) {
                        handlers.onInvalid("Enter a valid price");
                        return false;
                      }
                      return handlers.onSetPrice(key, paise);
                    }}
                    className={bigInput}
                  />
                </div>
              ) : null}
              {ctx.canDiscount ? (
                <div className="grid gap-1.5">
                  <label htmlFor={`${moreId}-discount`} className="text-sm font-medium">
                    Discount on this item ({line.discount.kind === "amount" ? "₹" : "%"})
                  </label>
                  <div className="flex items-center gap-2">
                    <CommitInput
                      id={`${moreId}-discount`}
                      inputMode="decimal"
                      enterKeyHint="done"
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
                      className={cn(bigInput, "flex-1")}
                    />
                    <DiscountKindToggle
                      kind={line.discount.kind}
                      label={`Discount on ${line.name}`}
                      className="size-12 rounded-xl text-base"
                      onChange={(kind) => handlers.onSetDiscount(key, kind === "amount" ? { kind, paise: 0 } : { kind, percent: 0 })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Your limit is {ctx.maxDiscountPercent}% of the bill.</p>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                GST {formatRate(line.gstRate)}
                {line.priceIncludesTax ? " included in the price" : " added to the price"}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong ? "text-lg font-semibold" : "text-sm text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

function Totals({ summary, ctx }: { summary: CartSummary; ctx: PosContext }) {
  const { totals } = summary;
  const tax = totals.cgstPaise + totals.sgstPaise + totals.igstPaise + totals.cessPaise;
  return (
    <div className="grid gap-1 rounded-xl border bg-background p-3">
      <dl className="grid gap-1">
        <Row label="Items total" value={formatINR(totals.subtotalPaise)} />
        {totals.discountPaise > 0 ? <Row label={`Discount (${summary.discountPercent}%)`} value={`− ${formatINR(totals.discountPaise)}`} /> : null}
        {summary.chargeTax ? <Row label="GST" value={formatINR(tax)} /> : null}
        {totals.roundOffPaise !== 0 ? <Row label="Round off" value={formatINR(totals.roundOffPaise)} /> : null}
        <Row label="Total" value={formatINR(totals.totalPaise)} strong />
      </dl>
      {summary.chargeTax ? (
        <details className="text-sm text-muted-foreground">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-1 font-medium text-primary [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4" aria-hidden /> Tax details
          </summary>
          <dl className="grid gap-1 pb-1">
            <Row label="Taxable value" value={formatINR(totals.taxablePaise)} />
            {summary.interState ? <Row label="IGST" value={formatINR(totals.igstPaise)} /> : null}
            {!summary.interState ? <Row label="CGST" value={formatINR(totals.cgstPaise)} /> : null}
            {!summary.interState ? <Row label="SGST" value={formatINR(totals.sgstPaise)} /> : null}
            {totals.cessPaise > 0 ? <Row label="Cess" value={formatINR(totals.cessPaise)} /> : null}
            <Row label="Place of supply" value={summary.placeOfSupply.label} />
          </dl>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">
          {ctx.gstScheme === "composition" ? "Composition scheme: no tax is charged on the bill." : "No GST is charged on this bill."}
        </p>
      )}
    </div>
  );
}

/**
 * The bill on a phone: a full-height sheet with each item as a big card
 * (− qty +, remove with Undo, and price or discount under "More" when the
 * role allows). Customer and bill discount are there but optional.
 */
export function BillSheet({
  open,
  onOpenChange,
  cart,
  summary,
  ctx,
  issues,
  handlers,
  parkedCount,
  dirty,
  posting,
  onOpenCustomer,
  onOpenDiscount,
  onHold,
  onOpenParked,
  onClear,
  onPay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartState;
  summary: CartSummary;
  ctx: PosContext;
  issues: CartIssue[];
  handlers: BillSheetHandlers;
  parkedCount: number;
  dirty: boolean;
  posting: boolean;
  onOpenCustomer: () => void;
  onOpenDiscount: () => void;
  onHold: () => void;
  onOpenParked: () => void;
  onClear: () => void;
  onPay: () => void;
}) {
  const inset = useKeyboardInset();
  const customer = cart.customer;
  const empty = cart.lines.length === 0;
  const issue = !empty ? issues[0] : undefined;
  const count = cart.lines.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        style={{ bottom: inset, height: `calc(100dvh - ${inset}px)` }}
        className="gap-0 bg-muted/40 data-[side=bottom]:border-t-0 motion-reduce:animate-none!"
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close the bill and go back to items"
            className="flex size-12 items-center justify-center rounded-xl outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-6" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold">Bill</SheetTitle>
            <SheetDescription className="text-sm">{empty ? "No items yet" : `${count} ${count === 1 ? "item" : "items"}`}</SheetDescription>
          </div>
          {!empty ? (
            <Button type="button" variant="outline" className="mr-1 h-11 px-3 text-base" onClick={() => onOpenChange(false)}>
              <Plus aria-hidden /> Add items
            </Button>
          ) : null}
        </div>

        <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto overscroll-contain p-3 pb-6">
          {empty ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-background">
                <ShoppingBasket className="size-7 text-muted-foreground" aria-hidden />
              </span>
              <p className="text-lg font-medium">No items yet</p>
              <p className="text-base text-muted-foreground">Tap an item to add it to the bill.</p>
              <Button type="button" size="lg" className="h-12 px-6 text-base" onClick={() => onOpenChange(false)}>
                Add items
              </Button>
            </div>
          ) : (
            <ul className="grid gap-2" aria-label="Items in the bill">
              {cart.lines.map((line) => (
                <LineCard key={line.key} line={line} ctx={ctx} handlers={handlers} />
              ))}
            </ul>
          )}

          {!empty ? (
            <div className="grid gap-2">
              <button
                type="button"
                onClick={onOpenCustomer}
                className="flex min-h-14 items-center gap-3 rounded-xl border bg-background px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">Customer{cart.supplyType === "b2b" ? " (B2B, GSTIN needed)" : " (optional)"}</span>
                  <span className="block truncate text-base font-medium">
                    {customer ? customer.name || formatMobile(customer.phone) || customer.phone || "Customer" : "Walk-in customer"}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-primary">{customer ? "Change" : "Add"}</span>
              </button>
              {ctx.canDiscount ? (
                <button
                  type="button"
                  onClick={onOpenDiscount}
                  className="flex min-h-14 items-center gap-3 rounded-xl border bg-background px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Percent className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">Bill discount (optional)</span>
                    <span className="tabular block truncate text-base font-medium">
                      {isDiscountSet(cart.billDiscount) ? `− ${formatINR(summary.billDiscountPaise)}` : "No discount"}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-primary">{isDiscountSet(cart.billDiscount) ? "Change" : "Add"}</span>
                </button>
              ) : null}
              <Totals summary={summary} ctx={ctx} />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {!empty ? (
              <Button type="button" variant="outline" className="h-11 flex-1 text-base" onClick={onHold}>
                <PauseCircle aria-hidden /> Hold bill
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="h-11 flex-1 text-base" onClick={onOpenParked}>
              <ReceiptText aria-hidden /> Held bills
              <span className="tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-sm">{parkedCount}</span>
            </Button>
            {dirty ? (
              <Button type="button" variant="ghost" className="h-11 flex-1 text-base text-destructive" onClick={onClear}>
                <X aria-hidden /> Clear bill
              </Button>
            ) : null}
          </div>
        </div>

        {!empty ? (
          <div className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {issue ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {issue.message}
              </p>
            ) : null}
            <Button type="button" size="lg" className="h-14 w-full justify-between px-5 text-lg" onClick={onPay} disabled={posting}>
              <span>Pay</span>
              <span className="tabular">{formatINR(summary.totals.totalPaise)}</span>
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
