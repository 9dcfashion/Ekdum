"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/shared/field";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/money";
import { isDiscountSet, type CartSummary } from "@/lib/pos/cart";
import type { CartState, Discount, PosContext } from "@/lib/pos/types";
import { DiscountKindToggle, discountInputValue, parseDiscountInput } from "./cart-lines";

function DiscountForm({
  cart,
  summary,
  ctx,
  onApply,
  onClose,
}: {
  cart: CartState;
  summary: CartSummary;
  ctx: PosContext;
  onApply: (discount: Discount) => string | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Discount["kind"]>(isDiscountSet(cart.billDiscount) ? cart.billDiscount.kind : "percent");
  const [text, setText] = useState(discountInputValue(cart.billDiscount));
  const [error, setError] = useState<string | null>(null);
  const lineDiscounts = summary.lineDiscountsPaise.reduce((a, b) => a + b, 0);

  function apply(discount: Discount | null) {
    if (!discount) return setError("Enter a valid discount");
    const problem = onApply(discount);
    if (problem) return setError(problem);
    onClose();
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        apply(parseDiscountInput(text, kind));
      }}
    >
      <Field
        label={kind === "percent" ? "Discount on the whole bill (%)" : "Discount on the whole bill (₹)"}
        htmlFor="pos-bill-discount"
        error={error}
        hint={`Your limit is ${ctx.maxDiscountPercent}% of the bill, counting discounts on items too.`}
      >
        <div className="flex items-center gap-1.5">
          <Input
            id="pos-bill-discount"
            autoFocus
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            className="tabular h-10 text-right text-lg"
          />
          <DiscountKindToggle
            kind={kind}
            label="Bill discount"
            onChange={(next) => {
              setKind(next);
              setText("");
              setError(null);
            }}
          />
        </div>
      </Field>
      <dl className="grid grid-cols-2 gap-y-1 text-sm text-muted-foreground">
        <dt>Subtotal</dt>
        <dd className="tabular text-right">{formatINR(summary.totals.subtotalPaise)}</dd>
        <dt>Discounts on items</dt>
        <dd className="tabular text-right">{formatINR(lineDiscounts)}</dd>
        <dt>Total discount now</dt>
        <dd className="tabular text-right">
          {formatINR(summary.totals.discountPaise)} ({summary.discountPercent}%)
        </dd>
      </dl>
      <DialogFooter>
        {isDiscountSet(cart.billDiscount) ? (
          <Button type="button" variant="outline" onClick={() => apply({ kind: "amount", paise: 0 })}>
            Remove discount
          </Button>
        ) : null}
        <Button type="submit">Apply discount</Button>
      </DialogFooter>
    </form>
  );
}

/** Bill-level discount (F8), as an amount or a percentage, checked against the role's limit. */
export function DiscountDialog({
  open,
  onOpenChange,
  onClosed,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  cart: CartState;
  summary: CartSummary;
  ctx: PosContext;
  onApply: (discount: Discount) => string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>Bill discount</DialogTitle>
          <DialogDescription>Spread across all items before tax is worked out.</DialogDescription>
        </DialogHeader>
        {open ? <DiscountForm {...form} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
