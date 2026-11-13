"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { Loader2, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adjustStockAction, getStockLevelAction, searchStockProductsAction } from "@/app/app/(shell)/inventory/actions";
import { ADJUSTMENT_REASONS, ADJUSTMENT_REASON_LABELS, adjustmentDelta, signedQty } from "@/lib/inventory/ledger";
import { adjustStockSchema, type AdjustStockInput, type StockProductOption } from "@/lib/inventory/validation";
import { Decimal, formatQty } from "@/lib/money";
import { useAction } from "@/lib/use-action";

interface Props {
  outlets: Array<{ id: string; name: string }>;
  defaultOutletId: string;
  /** Fixes the product (row button). Leave out to let the user search for one. */
  product?: StockProductOption;
  /** Stock of `product` at `defaultOutletId`. Pass it whenever `product` is set. */
  currentQuantity?: number | string;
  /** "row" renders a small quiet button for table rows. */
  variant?: "primary" | "row";
}

/** Stock adjustment: count the shelf or add/remove a quantity, always with a reason. Audited in the database. */
export function AdjustStockDialog(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {props.variant === "row" ? (
          <Button variant="outline" size="sm" aria-label={`Adjust stock of ${props.product?.name ?? "a product"}`}>
            Adjust
          </Button>
        ) : (
          <Button>
            <SlidersHorizontal aria-hidden /> Adjust stock
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
          <DialogDescription>For damage, loss or a recount. Every adjustment is recorded with your name and the reason.</DialogDescription>
        </DialogHeader>
        {open ? <AdjustForm {...props} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AdjustForm({ outlets, defaultOutletId, product: fixedProduct, currentQuantity, onDone }: Props & { onDone: () => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [product, setProduct] = useState<StockProductOption | null>(fixedProduct ?? null);
  // Known stock levels by "product:outlet", so a slow reply can never be shown against the wrong pair.
  const [levels, setLevels] = useState<Record<string, string>>(
    fixedProduct ? { [`${fixedProduct.id}:${defaultOutletId}`]: String(currentQuantity ?? 0) } : {},
  );

  const form = useForm<AdjustStockInput>({
    resolver: zodResolver(adjustStockSchema),
    defaultValues: {
      product_id: fixedProduct?.id ?? "",
      outlet_id: defaultOutletId,
      mode: "set",
      direction: "remove",
      quantity: "",
      reason: "" as AdjustStockInput["reason"],
      note: "",
    },
  });
  const { errors } = form.formState;
  const { control } = form;
  const mode = useWatch({ control, name: "mode" });
  const direction = useWatch({ control, name: "direction" });
  const quantity = useWatch({ control, name: "quantity" });
  const reason = useWatch({ control, name: "reason" });
  const outletId = useWatch({ control, name: "outlet_id" });

  async function loadLevel(productId: string, forOutlet: string) {
    let result;
    try {
      result = await getStockLevelAction({ product_id: productId, outlet_id: forOutlet });
    } catch {
      return;
    }
    if (!result.ok) return;
    const quantity = result.data.quantity;
    setLevels((known) => ({ ...known, [`${productId}:${forOutlet}`]: quantity }));
  }

  const current = product ? (levels[`${product.id}:${outletId}`] ?? null) : null;

  let preview: { delta: string; after: string } | null = null;
  let previewNote: string | null = null;
  if (current !== null && String(quantity ?? "").trim() !== "") {
    try {
      const delta = adjustmentDelta({ mode, quantity: String(quantity), direction, current });
      preview = { delta, after: new Decimal(current).plus(delta).toString() };
    } catch (error) {
      previewNote = error instanceof Error ? error.message : null;
    }
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.stopPropagation();
        void form.handleSubmit(() =>
          run(() => adjustStockAction(form.getValues()), {
            success: (data) => `Stock adjusted by ${signedQty(data.delta)}`,
            onSuccess: () => {
              onDone();
              router.refresh();
            },
            onError: (_e, fieldErrors) => {
              for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
                if (name !== "_form" && messages[0]) form.setError(name as keyof AdjustStockInput, { message: messages[0] });
              }
            },
          }),
        )(e);
      }}
    >
      {fixedProduct ? (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{fixedProduct.name}</span>
          {fixedProduct.sku ? <span className="text-muted-foreground"> · SKU {fixedProduct.sku}</span> : null}
        </div>
      ) : product ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{product.name}</span>
            {product.sku ? <span className="text-muted-foreground"> · SKU {product.sku}</span> : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Choose a different product"
            onClick={() => {
              setProduct(null);
              form.setValue("product_id", "");
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <Field label="Product" htmlFor="adj-product" required error={errors.product_id ? "Choose a product" : undefined}>
          <StockProductSearch
            id="adj-product"
            onPick={(p) => {
              setProduct(p);
              form.setValue("product_id", p.id, { shouldValidate: true });
              void loadLevel(p.id, form.getValues("outlet_id"));
            }}
          />
        </Field>
      )}

      {outlets.length > 1 ? (
        <Field label="Outlet" htmlFor="adj-outlet" required error={errors.outlet_id?.message}>
          <NativeSelect
            id="adj-outlet"
            {...form.register("outlet_id", {
              onChange: (e) => {
                if (product) void loadLevel(product.id, String(e.target.value));
              },
            })}
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">What do you want to do?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: "set", label: "Set counted quantity", sub: "I counted the shelf" },
              { value: "change", label: "Add or remove", sub: "A known quantity" },
            ] as const
          ).map((option) => (
            <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5">
              <input type="radio" value={option.value} className="mt-0.5 accent-[var(--primary)]" {...form.register("mode")} />
              <span>
                {option.label}
                <span className="block text-xs text-muted-foreground">{option.sub}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "change" ? (
          <Field label="Direction" htmlFor="adj-direction" required>
            <NativeSelect id="adj-direction" {...form.register("direction")}>
              <option value="remove">Remove from stock (-)</option>
              <option value="add">Add to stock (+)</option>
            </NativeSelect>
          </Field>
        ) : null}
        <Field
          label={mode === "set" ? `Counted quantity${product ? ` (${product.unit_code})` : ""}` : `Quantity${product ? ` (${product.unit_code})` : ""}`}
          htmlFor="adj-qty"
          required
          error={errors.quantity?.message}
          className={mode === "set" ? "sm:col-span-2" : undefined}
        >
          <Input id="adj-qty" inputMode="decimal" autoComplete="off" className="tabular" aria-invalid={!!errors.quantity || undefined} {...form.register("quantity")} />
        </Field>
      </div>

      <p className="tabular -mt-2 text-sm text-muted-foreground" aria-live="polite">
        {!product
          ? "Choose a product to see its current stock."
          : current === null
            ? "Checking current stock"
            : preview
              ? `Stock will go from ${formatQty(current)} to ${formatQty(preview.after)} (${signedQty(preview.delta)}).`
              : (previewNote ?? `Current stock: ${formatQty(current)} ${product.unit_code}`)}
      </p>

      <Field label="Reason" htmlFor="adj-reason" required error={errors.reason?.message}>
        <NativeSelect id="adj-reason" aria-invalid={!!errors.reason || undefined} {...form.register("reason")}>
          <option value="">Select a reason</option>
          {ADJUSTMENT_REASONS.map((r) => (
            <option key={r} value={r}>
              {ADJUSTMENT_REASON_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Note" htmlFor="adj-note" required={reason === "other"} error={errors.note?.message} hint={reason === "other" ? "Say what happened" : "Optional"}>
        <Textarea id="adj-note" rows={2} maxLength={300} {...form.register("note")} />
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>Save adjustment</SubmitButton>
      </DialogFooter>
    </form>
  );
}

function StockProductSearch({ id, onPick }: { id: string; onPick: (product: StockProductOption) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; rows: StockProductOption[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function search(text: string) {
    const ticket = ++latest.current;
    setLoading(true);
    let result;
    try {
      result = await searchStockProductsAction({ q: text });
    } catch {
      result = null;
    }
    if (ticket !== latest.current) return;
    setLoading(false);
    if (!result || !result.ok) {
      toast.error(result ? result.error : "Could not reach the server. Check your connection.");
      return;
    }
    setFound({ q: text, rows: result.data });
  }

  const text = q.trim();
  const rows = found && found.q === text ? found.rows : null;

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          value={q}
          autoFocus
          autoComplete="off"
          placeholder="Type a name, SKU or barcode"
          onChange={(e) => {
            const next = e.target.value;
            setQ(next);
            if (timer.current) clearTimeout(timer.current);
            if (!next.trim()) {
              latest.current++;
              setFound(null);
              setLoading(false);
              return;
            }
            timer.current = setTimeout(() => void search(next.trim()), 250);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (rows && rows.length === 1) onPick(rows[0]);
          }}
          className="pr-8"
        />
        {loading ? <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
      </div>
      {text && rows ? (
        rows.length > 0 ? (
          <ul className="mt-1.5 max-h-48 divide-y overflow-y-auto rounded-lg border">
            {rows.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p)} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[p.sku ? `SKU ${p.sku}` : null, p.unit_code].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">No stock-tracked product matches &quot;{text}&quot;.</p>
        )
      ) : null}
    </div>
  );
}
