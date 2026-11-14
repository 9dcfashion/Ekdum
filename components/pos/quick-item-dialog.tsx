"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { MoneyInput } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { computeInvoice } from "@/lib/gst";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/money";
import { initialRatePaise, lastRateStorageKey, parseLastRates, quickItemInput, quickItemTaxLabel, rememberRate, stepQuantity } from "@/lib/pos/quick-items";
import type { ManualItemInput, PosContext, QuickItem } from "@/lib/pos/types";
import { newClientUuid } from "@/lib/pos/uuid";
import { cn } from "@/lib/utils";
import { readStored, useKeyboardInset, writeStored } from "./use-quick-bill";

function QuickItemForm({
  item,
  ctx,
  businessId,
  large,
  onAdd,
  onDone,
}: {
  item: QuickItem;
  ctx: PosContext;
  businessId: string;
  /** Phone layout: bigger fields and buttons. */
  large: boolean;
  onAdd: (input: ManualItemInput) => string | null;
  onDone: () => void;
}) {
  const chargesTax = ctx.gstScheme === "regular";
  const storageKey = lastRateStorageKey(businessId);
  const [rate, setRate] = useState(() => {
    const paise = initialRatePaise(item, parseLastRates(readStored(storageKey)));
    return paise ? paiseToRupees(paise) : "";
  });
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const ratePaise = rupeesToPaise(rate);
  const qtyOk = (item.allowDecimal ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(quantity.trim()) && Number(quantity) > 0;

  // Live amount with the same engine the bill uses.
  let preview: { total: number; tax: number } | null = null;
  if (ratePaise && ratePaise > 0 && qtyOk) {
    try {
      const t = computeInvoice({
        lines: [
          {
            quantity: quantity.trim(),
            unitPricePaise: ratePaise,
            priceIncludesTax: chargesTax ? item.priceIncludesTax : true,
            gstRate: chargesTax ? item.gstRate : 0,
          },
        ],
        chargeTax: chargesTax,
        isInterState: false,
        roundOff: false,
      });
      preview = { total: t.totalPaise, tax: t.taxPaise };
    } catch {
      preview = null;
    }
  }

  function submit() {
    if (ratePaise === null || ratePaise <= 0) return setError("Enter the rate");
    const problem = onAdd(quickItemInput(item, { key: `manual-${newClientUuid()}`, quantity, ratePaise }));
    if (problem) return setError(problem);
    writeStored(storageKey, JSON.stringify(rememberRate(parseLastRates(readStored(storageKey)), item.id, ratePaise)));
    onDone();
  }

  const field = large ? "h-14 text-2xl md:text-2xl" : "h-11 text-lg md:text-lg";
  const stepButton = cn(
    "flex shrink-0 items-center justify-center rounded-xl border border-input bg-background outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
    large ? "size-14" : "size-11",
  );

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-1.5">
        <label htmlFor="pos-quick-rate" className="text-sm font-medium">
          Rate (₹){chargesTax ? (item.priceIncludesTax ? ", with GST" : ", before GST") : ""}
        </label>
        <MoneyInput
          id="pos-quick-rate"
          autoFocus
          enterKeyHint="done"
          placeholder="0"
          value={rate}
          aria-invalid={error === "Enter the rate" ? true : undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            setRate(e.target.value);
            setError(null);
          }}
          className={cn("text-right font-semibold", field)}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="pos-quick-qty" className="text-sm font-medium">
          Quantity <span className="font-normal text-muted-foreground">({item.unitCode})</span>
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="One less"
            className={stepButton}
            onClick={() => {
              setQuantity(stepQuantity(quantity, -1, item.allowDecimal));
              setError(null);
            }}
          >
            <Minus className="size-5" aria-hidden />
          </button>
          <input
            id="pos-quick-qty"
            type="text"
            inputMode={item.allowDecimal ? "decimal" : "numeric"}
            enterKeyHint="done"
            autoComplete="off"
            value={quantity}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setQuantity(e.target.value);
              setError(null);
            }}
            className={cn(
              "tabular w-full min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-center outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              field,
            )}
          />
          <button
            type="button"
            aria-label="One more"
            className={stepButton}
            onClick={() => {
              setQuantity(stepQuantity(quantity, 1, item.allowDecimal));
              setError(null);
            }}
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid gap-1 rounded-xl bg-muted/60 px-3 py-2.5" aria-live="polite">
        <p className="text-sm text-muted-foreground">{quickItemTaxLabel(item, chargesTax)}</p>
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-base">Amount</span>
          <span className="tabular text-2xl font-semibold">{preview ? formatINR(preview.total) : formatINR(0)}</span>
        </p>
        {preview && chargesTax && preview.tax > 0 ? <p className="tabular text-right text-sm text-muted-foreground">GST {formatINR(preview.tax)}</p> : null}
      </div>

      <p className={cn("min-h-5 text-sm text-destructive", !error && "invisible")} role={error ? "alert" : undefined}>
        {error ?? "No problem"}
      </p>

      <Button type="submit" size="lg" className={cn("w-full text-lg", large ? "h-14" : "h-12")}>
        Add to bill
      </Button>
    </form>
  );
}

/**
 * Bill a preset quick item (e.g. "Necklace"): the cashier types only the rate
 * and quantity. A bottom sheet on phones, a dialog on desktop. Enter adds.
 */
export function QuickItemDialog({
  item,
  variant,
  onOpenChange,
  onClosed,
  ...form
}: {
  item: QuickItem | null;
  variant: "sheet" | "dialog";
  onOpenChange: (open: boolean) => void;
  /** After closing. Return false to let focus go back to the button that opened it. */
  onClosed: () => boolean | void;
  ctx: PosContext;
  businessId: string;
  onAdd: (input: ManualItemInput) => string | null;
}) {
  const inset = useKeyboardInset();
  const open = item !== null;
  const body = item ? <QuickItemForm key={item.id} item={item} large={variant === "sheet"} {...form} onDone={() => onOpenChange(false)} /> : null;
  const closeAutoFocus = (e: Event) => {
    if (onClosed() !== false) e.preventDefault();
  };

  if (variant === "sheet") {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          style={inset > 0 ? { bottom: inset } : undefined}
          className="max-h-[100dvh] gap-0 overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] motion-reduce:animate-none!"
          onCloseAutoFocus={closeAutoFocus}
        >
          <SheetHeader className="flex-row items-start gap-3 px-4 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-xl font-semibold">{item?.name}</SheetTitle>
              <SheetDescription>Type the rate and quantity.</SheetDescription>
            </div>
            <Button type="button" variant="outline" className="h-11 px-4" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </SheetHeader>
          <div className="px-4">{body}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto" onCloseAutoFocus={closeAutoFocus}>
        <DialogHeader>
          <DialogTitle className="text-lg">{item?.name}</DialogTitle>
          <DialogDescription>Type the rate and quantity, then press Enter.</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
