"use client";

import { useState } from "react";
import { ChevronDown, Minus, Plus, Trash2 } from "lucide-react";
import { useFormState, useWatch, type UseFormReturn } from "react-hook-form";
import { MoneyInput, NativeSelect } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineResult } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { canDecreaseQuantity, stepQuantity } from "@/lib/purchases/flow";
import type { GstRateOption, UnitOption } from "@/lib/purchases/types";
import { cn } from "@/lib/utils";
import type { PurchaseBillData, PurchaseBillInput } from "@/lib/validation/purchases";

type BillForm = UseFormReturn<PurchaseBillInput, unknown, PurchaseBillData>;

const big = "h-12 text-base lg:h-10";

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="mt-1 text-sm text-destructive" role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * One line of the purchase bill as a card: name, quantity with − / +, rate,
 * and the amount. GST rate, HSN, discount, "rate includes GST", cess and unit
 * sit under "More" (opened automatically when one of them has a problem).
 */
export function ItemCard({
  form,
  index,
  fieldId,
  units,
  gstRates,
  result,
  lastRatePaise,
  onRemove,
}: {
  form: BillForm;
  index: number;
  fieldId: string;
  units: UnitOption[];
  gstRates: GstRateOption[];
  result: LineResult | null;
  /** Last purchase rate before GST, when known and the user may see it. */
  lastRatePaise: number | null;
  onRemove: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const line = useWatch({ control: form.control, name: `lines.${index}` });
  // Subscribe here: the parent passes the same `form` object every render, so it would not re-render this card on errors.
  const { errors } = useFormState({ control: form.control, name: `lines.${index}` });
  // react-hook-form updates nested error objects in place, so read plain strings (safe with the React Compiler's memoisation).
  const e = errors.lines?.[index];
  const err = {
    description: e?.description?.message,
    quantity: e?.quantity?.message,
    rate: e?.rate?.message,
    discount: e?.discount?.message,
    gst: e?.gst_rate?.message,
    cess: e?.cess_rate?.message,
    hsn: e?.hsn_code?.message,
    unit: e?.unit_code?.message,
  };
  const hasError = Object.values(err).some(Boolean);
  const p = `line-${fieldId}`;
  const isExpense = !line?.product_id;
  const name = String(line?.description ?? "").trim() || (isExpense ? "Other expense" : "Item");
  const unit = String(line?.unit_code ?? "");
  const rateNow = String(line?.gst_rate ?? "");
  const rateListed = gstRates.some((r) => String(r.rate) === rateNow);
  const unitListed = units.some((u) => u.code === unit);
  const includesTax = !!line?.price_includes_tax;
  const moreHasError = !!(err.gst || err.hsn || err.discount || err.cess || err.unit || (!isExpense && err.description));
  const open = moreOpen || moreHasError;
  const discount = String(line?.discount ?? "").trim();
  const cess = Number(line?.cess_rate ?? 0);

  function setQty(next: string) {
    form.setValue(`lines.${index}.quantity`, next, { shouldDirty: true, shouldValidate: !!err.quantity });
  }

  return (
    <li className={cn("rounded-xl border bg-card p-3 shadow-xs", hasError && "border-destructive/50")} data-line-index={index}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {isExpense ? (
            <>
              <Label htmlFor={`${p}-desc`} className="text-sm text-muted-foreground">
                Other expense (no stock)
              </Label>
              <Input
                id={`${p}-desc`}
                placeholder="What is it? For example: Freight"
                autoComplete="off"
                className={cn("mt-1", big)}
                aria-invalid={!!err.description || undefined}
                {...form.register(`lines.${index}.description`)}
              />
              <FieldError message={err.description} />
            </>
          ) : (
            <>
              <p className="line-clamp-2 text-base font-semibold">{name}</p>
              <p className="text-sm text-muted-foreground">
                GST {rateNow || "0"}%{cess > 0 ? ` + cess ${cess}%` : ""}
                {line?.hsn_code ? ` · HSN ${line.hsn_code}` : ""}
                {discount ? ` · Discount ₹${discount}` : ""}
              </p>
            </>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Trash2 className="size-5" aria-hidden />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${p}-qty`} className="text-sm">
            Qty{unit ? ` (${unit})` : ""}
          </Label>
          <div className="mt-1 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="size-12 shrink-0 lg:size-10"
              aria-label={`One less ${name}`}
              disabled={!canDecreaseQuantity(line?.quantity)}
              onClick={() => setQty(stepQuantity(line?.quantity, -1))}
            >
              <Minus className="size-5" aria-hidden />
            </Button>
            <Input
              id={`${p}-qty`}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="next"
              className={cn("tabular min-w-0 flex-1 text-center text-lg font-semibold", big)}
              aria-invalid={!!err.quantity || undefined}
              onFocus={(ev) => ev.currentTarget.select()}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  form.setFocus(`lines.${index}.rate`, { shouldSelect: true });
                }
              }}
              {...form.register(`lines.${index}.quantity`)}
            />
            <Button
              type="button"
              variant="outline"
              className="size-12 shrink-0 lg:size-10"
              aria-label={`One more ${name}`}
              onClick={() => setQty(stepQuantity(line?.quantity, 1))}
            >
              <Plus className="size-5" aria-hidden />
            </Button>
          </div>
          <FieldError message={err.quantity} />
        </div>
        <div>
          <Label htmlFor={`${p}-rate`} className="text-sm">
            Rate per {unit || "unit"} <span className="font-normal text-muted-foreground">({includesTax ? "with GST" : "before GST"})</span>
          </Label>
          <div className="mt-1">
            <MoneyInput
              id={`${p}-rate`}
              enterKeyHint="done"
              className={cn("text-lg font-semibold", big)}
              aria-invalid={!!err.rate || undefined}
              onFocus={(ev) => ev.currentTarget.select()}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  // Straight on to the next item.
                  document.querySelector<HTMLInputElement>("[data-item-search]")?.focus();
                }
              }}
              {...form.register(`lines.${index}.rate`)}
            />
          </div>
          {err.rate ? (
            <FieldError message={err.rate} />
          ) : lastRatePaise !== null ? (
            <p className="mt-1 text-sm text-muted-foreground">Last time {formatINR(lastRatePaise)} before GST</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-11 px-2 text-sm text-muted-foreground"
          aria-expanded={open}
          aria-controls={`${p}-more`}
          onClick={() => setMoreOpen(!open)}
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
          More: GST, HSN, discount
        </Button>
        <p className="tabular text-right">
          {result ? (
            <>
              <span className="block text-lg font-semibold">{formatINR(result.totalPaise)}</span>
              <span className="block text-xs text-muted-foreground">
                {formatINR(result.taxablePaise)} + GST {formatINR(result.totalPaise - result.taxablePaise)}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Fill qty and rate</span>
          )}
        </p>
      </div>

      <div id={`${p}-more`} hidden={!open} className="mt-2 grid gap-3 border-t pt-3 sm:grid-cols-2">
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-base sm:col-span-2">
          <input type="checkbox" className="size-5 shrink-0 accent-[var(--primary)]" {...form.register(`lines.${index}.price_includes_tax`)} />
          <span>
            Rate includes GST
            <span className="block text-sm text-muted-foreground">Tick this if the rate on the paper already has GST in it.</span>
          </span>
        </label>
        <div>
          <Label htmlFor={`${p}-gst`} className="text-sm">
            GST rate
          </Label>
          <NativeSelect id={`${p}-gst`} className={cn("mt-1", big)} aria-invalid={!!err.gst || undefined} {...form.register(`lines.${index}.gst_rate`)}>
            {rateListed || !rateNow ? null : <option value={rateNow}>{rateNow}%</option>}
            {gstRates.map((r) => (
              <option key={r.rate} value={String(r.rate)}>
                {r.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={err.gst} />
        </div>
        <div>
          <Label htmlFor={`${p}-disc`} className="text-sm">
            Discount on this line (₹)
          </Label>
          <div className="mt-1">
            <MoneyInput id={`${p}-disc`} placeholder="0.00" className={big} aria-invalid={!!err.discount || undefined} {...form.register(`lines.${index}.discount`)} />
          </div>
          <FieldError message={err.discount} />
        </div>
        <div>
          <Label htmlFor={`${p}-hsn`} className="text-sm">
            HSN code
          </Label>
          <Input
            id={`${p}-hsn`}
            inputMode="numeric"
            maxLength={8}
            autoComplete="off"
            className={cn("tabular mt-1", big)}
            aria-invalid={!!err.hsn || undefined}
            {...form.register(`lines.${index}.hsn_code`)}
          />
          <FieldError message={err.hsn} />
        </div>
        <div>
          <Label htmlFor={`${p}-cess`} className="text-sm">
            Cess %
          </Label>
          <Input
            id={`${p}-cess`}
            inputMode="decimal"
            autoComplete="off"
            className={cn("tabular mt-1", big)}
            aria-invalid={!!err.cess || undefined}
            {...form.register(`lines.${index}.cess_rate`)}
          />
          <FieldError message={err.cess} />
        </div>
        <div>
          <Label htmlFor={`${p}-unit`} className="text-sm">
            Unit
          </Label>
          <NativeSelect id={`${p}-unit`} className={cn("mt-1", big)} aria-invalid={!!err.unit || undefined} {...form.register(`lines.${index}.unit_code`)}>
            {unitListed || !unit ? null : <option value={unit}>{unit}</option>}
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name} ({u.code})
              </option>
            ))}
          </NativeSelect>
          <FieldError message={err.unit} />
        </div>
        {!isExpense ? (
          <div>
            <Label htmlFor={`${p}-desc`} className="text-sm">
              Name on this bill
            </Label>
            <Input
              id={`${p}-desc`}
              autoComplete="off"
              className={cn("mt-1", big)}
              aria-invalid={!!err.description || undefined}
              {...form.register(`lines.${index}.description`)}
            />
            <FieldError message={err.description} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
