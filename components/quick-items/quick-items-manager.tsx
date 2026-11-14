"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { StatusBadge } from "@/components/shared/status-badge";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatRate } from "@/lib/gst";
import { formatINR, paiseToRupees } from "@/lib/money";
import {
  addQuickItemPackAction,
  deleteQuickItemAction,
  moveQuickItemAction,
  saveQuickItemAction,
  setQuickItemActiveAction,
} from "@/lib/quick-items/actions";
import { useAction } from "@/lib/use-action";
import { quickItemSchema, type QuickItemInput } from "@/lib/validation/quick-items";

export interface QuickItemRow {
  id: string;
  name: string;
  gst_rate: number;
  hsn_code: string | null;
  unit_code: string;
  price_includes_tax: boolean;
  default_rate_paise: number | null;
  is_active: boolean;
}

export interface PackOffer {
  key: string;
  label: string;
  description: string;
  missing: number;
  total: number;
}

function describe(item: QuickItemRow, chargesTax: boolean): string {
  const parts = [item.unit_code];
  if (chargesTax) parts.unshift(`GST ${formatRate(item.gst_rate)} ${item.price_includes_tax ? "incl." : "extra"}`);
  if (item.hsn_code) parts.push(`HSN ${item.hsn_code}`);
  if (item.default_rate_paise) parts.push(`usual ${formatINR(item.default_rate_paise)}`);
  return parts.join(" · ");
}

function ItemDialog({
  open,
  onOpenChange,
  item,
  gstRates,
  units,
  chargesTax,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: QuickItemRow | null;
  gstRates: number[];
  units: Array<{ code: string; name: string }>;
  chargesTax: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const form = useForm<QuickItemInput>({
    resolver: zodResolver(quickItemSchema),
    defaultValues: {
      id: item?.id,
      name: item?.name ?? "",
      gst_rate: item ? String(item.gst_rate) : chargesTax ? "" : "0",
      hsn_code: item?.hsn_code ?? "",
      unit_code: item?.unit_code ?? "PCS",
      price_includes_tax: item?.price_includes_tax ?? false,
      default_rate: item?.default_rate_paise ? paiseToRupees(item.default_rate_paise) : "",
      is_active: item?.is_active ?? true,
    },
  });
  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? "Edit quick item" : "New quick item"}</DialogTitle>
          <DialogDescription>Staff tap this at the counter and only type the rate and quantity.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) =>
            run(() => saveQuickItemAction(values), {
              success: item ? "Saved" : "Quick item added",
              onSuccess: () => {
                onOpenChange(false);
                router.refresh();
              },
              onError: (_e, fieldErrors) => {
                for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
                  if (messages[0] && name !== "_form") form.setError(name as keyof QuickItemInput, { message: messages[0] });
                }
              },
            }),
          )}
        >
          <Field label="Item name" htmlFor="qi-name" required error={errors.name?.message}>
            <Input id="qi-name" autoFocus maxLength={60} placeholder="e.g. Necklace" {...form.register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {chargesTax ? (
              <Field label="GST rate" htmlFor="qi-gst" required error={errors.gst_rate?.message}>
                <NativeSelect id="qi-gst" {...form.register("gst_rate")}>
                  <option value="">Select</option>
                  {gstRates.map((r) => (
                    <option key={r} value={String(r)}>
                      {formatRate(r)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label="HSN code" htmlFor="qi-hsn" error={errors.hsn_code?.message} hint="4, 6 or 8 digits">
              <Input id="qi-hsn" inputMode="numeric" maxLength={8} className="tabular" {...form.register("hsn_code")} />
            </Field>
            <Field label="Unit" htmlFor="qi-unit" error={errors.unit_code?.message}>
              <NativeSelect id="qi-unit" {...form.register("unit_code")}>
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} ({u.name})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Usual rate" htmlFor="qi-rate" error={errors.default_rate?.message} hint="Optional. Filled in at the counter.">
              <MoneyInput id="qi-rate" {...form.register("default_rate")} />
            </Field>
          </div>
          {chargesTax ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" {...form.register("price_includes_tax")} />
              The rate staff type already includes GST
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton pending={pending}>{item ? "Save" : "Add item"}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuickItemsManager({
  items,
  packs,
  gstRates,
  units,
  chargesTax,
}: {
  items: QuickItemRow[];
  packs: PackOffer[];
  gstRates: number[];
  units: Array<{ code: string; name: string }>;
  chargesTax: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<QuickItemRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div className="grid gap-4">
      {packs
        .filter((p) => p.missing > 0)
        .map((pack) => (
          <div key={pack.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                <Sparkles className="size-4 text-primary" aria-hidden /> Ready-made {pack.label.toLowerCase()} items
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{pack.description}</p>
            </div>
            <SubmitButton
              type="button"
              pending={pending}
              onClick={() =>
                run(() => addQuickItemPackAction({ pack: pack.key }), {
                  success: (r) => (r.added ? `Added ${r.added} items` : "You already have all of them"),
                  onSuccess: () => router.refresh(),
                })
              }
            >
              {pack.missing === pack.total ? `Add ${pack.total} items` : `Add ${pack.missing} missing`}
            </SubmitButton>
          </div>
        ))}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "item" : "items"}. They show up in this order on the billing screen.
        </p>
        <Button type="button" onClick={openNew}>
          <Plus aria-hidden /> New quick item
        </Button>
      </div>

      {items.length > 0 ? (
        <ul className="divide-y rounded-xl border">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${item.name} up`}
                  disabled={i === 0 || pending}
                  onClick={() => run(() => moveQuickItemAction({ id: item.id, direction: "up" }), { onSuccess: () => router.refresh() })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Move ${item.name} down`}
                  disabled={i === items.length - 1 || pending}
                  onClick={() => run(() => moveQuickItemAction({ id: item.id, direction: "down" }), { onSuccess: () => router.refresh() })}
                >
                  <ArrowDown />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {item.name}
                  {!item.is_active ? <StatusBadge status="inactive" label="Hidden" /> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{describe(item, chargesTax)}</p>
              </div>
              <Switch
                checked={item.is_active}
                aria-label={item.is_active ? `Hide ${item.name} at the counter` : `Show ${item.name} at the counter`}
                onCheckedChange={(checked) =>
                  run(() => setQuickItemActiveAction({ id: item.id, is_active: checked }), { onSuccess: () => router.refresh() })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${item.name}`}
                onClick={() => {
                  setEditing(item);
                  setDialogOpen(true);
                }}
              >
                <Pencil />
              </Button>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${item.name}`}>
                    <Trash2 />
                  </Button>
                }
                title={`Delete "${item.name}"?`}
                description="It disappears from the billing screen. Bills already made keep it."
                confirmLabel="Delete"
                destructive
                onConfirm={() =>
                  new Promise<boolean>((resolve) =>
                    run(() => deleteQuickItemAction({ id: item.id }), {
                      success: "Deleted",
                      onSuccess: () => {
                        router.refresh();
                        resolve(true);
                      },
                      onError: () => resolve(false),
                    }),
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      {dialogOpen ? (
        <ItemDialog
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          item={editing}
          gstRates={gstRates}
          units={units}
          chargesTax={chargesTax}
        />
      ) : null}
    </div>
  );
}
