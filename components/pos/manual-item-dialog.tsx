"use client";

import { useState } from "react";
import { PackagePlus } from "lucide-react";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { computeInvoice, formatRate } from "@/lib/gst";
import { formatINR, rupeesToPaise } from "@/lib/money";
import type { ManualItemInput, PosContext, PosSettings } from "@/lib/pos/types";
import { newClientUuid } from "@/lib/pos/uuid";

// The last GST rate and unit used for a manual item on this device, so repeat entries are quick.
const LAST_KEY = "ekdum:pos:manual-item";

function readLast(): { gstRate?: number; unitCode?: string; priceIncludesTax?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveLast(value: { gstRate: number; unitCode: string; priceIncludesTax: boolean }) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(value));
  } catch {
    /* private mode: nothing to remember */
  }
}

function ManualItemForm({
  initialName,
  ctx,
  settings,
  onAdd,
  onClose,
}: {
  initialName: string;
  ctx: PosContext;
  settings: PosSettings;
  onAdd: (input: ManualItemInput) => string | null;
  onClose: () => void;
}) {
  const chargesTax = ctx.gstScheme === "regular";
  const [last] = useState(readLast);
  const units = settings.units.length > 0 ? settings.units : [{ code: "PCS", name: "Pieces", allow_decimal: false }];
  const rememberedRate = last.gstRate !== undefined && settings.gstRates.includes(last.gstRate) ? String(last.gstRate) : "";
  const rememberedUnit = units.some((u) => u.code === last.unitCode) ? last.unitCode! : units[0].code;

  const [name, setName] = useState(initialName);
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitCode, setUnitCode] = useState(rememberedUnit);
  // No GST rate is preselected the first time: the cashier must choose it, so tax is never guessed.
  const [gstRate, setGstRate] = useState(rememberedRate);
  const [priceIncludesTax, setPriceIncludesTax] = useState(last.priceIncludesTax ?? true);
  const [hsn, setHsn] = useState("");
  const [error, setError] = useState<string | null>(null);

  const unit = units.find((u) => u.code === unitCode) ?? units[0];
  const pricePaise = rupeesToPaise(price);

  // Live "customer pays" preview with the same engine the bill uses.
  let preview: { total: number; tax: number } | null = null;
  if (pricePaise && pricePaise > 0 && /^\d+(\.\d{1,3})?$/.test(quantity.trim()) && Number(quantity) > 0 && (!chargesTax || gstRate !== "")) {
    try {
      const t = computeInvoice({
        lines: [{ quantity: quantity.trim(), unitPricePaise: pricePaise, priceIncludesTax: chargesTax ? priceIncludesTax : true, gstRate: chargesTax ? gstRate : 0 }],
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
    if (!name.trim()) return setError("Enter the item name");
    if (pricePaise === null || pricePaise <= 0) return setError("Enter a price more than zero");
    if (chargesTax && gstRate === "") return setError("Select the GST rate for this item");
    const problem = onAdd({
      key: `manual-${newClientUuid()}`,
      name,
      quantity: quantity.trim(),
      unitPricePaise: pricePaise,
      priceIncludesTax,
      gstRate: chargesTax ? Number(gstRate) : 0,
      hsnCode: hsn,
      unitCode: unit.code,
      allowDecimal: unit.allow_decimal,
    });
    if (problem) return setError(problem);
    if (chargesTax) saveLast({ gstRate: Number(gstRate), unitCode: unit.code, priceIncludesTax });
    else saveLast({ gstRate: 0, unitCode: unit.code, priceIncludesTax: true });
    onClose();
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Item name" htmlFor="pos-manual-name" required>
        <Input
          id="pos-manual-name"
          autoFocus
          autoComplete="off"
          maxLength={200}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="e.g. Silk saree, blue"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={chargesTax ? (priceIncludesTax ? "Price (incl. GST)" : "Price (before GST)") : "Price"} htmlFor="pos-manual-price" required>
          <MoneyInput
            id="pos-manual-price"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              setError(null);
            }}
            className="h-10 text-right text-lg"
          />
        </Field>
        <Field label="Quantity" htmlFor="pos-manual-qty" required>
          <div className="flex items-center gap-1.5">
            <Input
              id="pos-manual-qty"
              inputMode={unit.allow_decimal ? "decimal" : "numeric"}
              autoComplete="off"
              value={quantity}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setQuantity(e.target.value);
                setError(null);
              }}
              className="tabular h-10 min-w-0 text-right"
            />
            <NativeSelect aria-label="Unit" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} className="h-10 w-24 shrink-0">
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code}
                </option>
              ))}
            </NativeSelect>
          </div>
        </Field>
      </div>

      {chargesTax ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="GST rate" htmlFor="pos-manual-gst" required>
            <NativeSelect
              id="pos-manual-gst"
              value={gstRate}
              onChange={(e) => {
                setGstRate(e.target.value);
                setError(null);
              }}
              className="h-10"
            >
              <option value="">Select</option>
              {settings.gstRates.map((r) => (
                <option key={r} value={String(r)}>
                  {formatRate(r)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="HSN code" htmlFor="pos-manual-hsn" hint="Optional. 4, 6 or 8 digits.">
            <Input
              id="pos-manual-hsn"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={hsn}
              onChange={(e) => {
                setHsn(e.target.value.replace(/\D/g, ""));
                setError(null);
              }}
              className="tabular h-10"
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={priceIncludesTax} onChange={(e) => setPriceIncludesTax(e.target.checked)} />
            Price already includes GST
          </label>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm" aria-live="polite">
        <span className="text-muted-foreground">Customer pays</span>
        <span className="tabular font-semibold">
          {preview ? formatINR(preview.total) : "—"}
          {preview && chargesTax ? <span className="ml-1 font-normal text-muted-foreground">(GST {formatINR(preview.tax)})</span> : null}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          For things that are not in your product list. No stock is reduced for it. You can attach a photo of what was given after taking payment.
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">
          <PackagePlus aria-hidden /> Add to bill
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Add an item that is not in the product list: name, price, quantity and GST typed at the counter. */
export function ManualItemDialog({
  open,
  initialName,
  onOpenChange,
  onClosed,
  ...form
}: {
  open: boolean;
  /** Prefilled from the search box when nothing matched. */
  initialName: string;
  onOpenChange: (open: boolean) => void;
  /** After closing. Return false to let focus go back to the button that opened it (phones). */
  onClosed: () => boolean | void;
  ctx: PosContext;
  settings: PosSettings;
  onAdd: (input: ManualItemInput) => string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] overflow-y-auto"
        onCloseAutoFocus={(e) => {
          if (onClosed() !== false) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add an item not in your list</DialogTitle>
          <DialogDescription>Bill something you have not added to Products yet.</DialogDescription>
        </DialogHeader>
        {open ? <ManualItemForm key={initialName} initialName={initialName} {...form} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
