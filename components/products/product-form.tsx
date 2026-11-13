"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { computeInvoice } from "@/lib/gst/engine";
import { formatINR, formatQty, rupeesToPaise } from "@/lib/money";
import { useAction } from "@/lib/use-action";
import { productSchema, type ProductFormInput } from "@/lib/validation/products";
import { saveCategoryAction, saveProductAction } from "@/app/app/(shell)/products/actions";

export interface ProductFormCategory {
  id: string;
  label: string;
  /** Null for a top-level category. */
  parent_id: string | null;
}

export interface ProductFormProps {
  /** Null when creating. */
  productId: string | null;
  defaults: ProductFormInput;
  categories: ProductFormCategory[];
  units: Array<{ code: string; name: string }>;
  gstRates: Array<{ rate: number; label: string }>;
  /** Create: outlets that get an opening stock input. */
  outlets: Array<{ id: string; name: string }>;
  /** Edit: current stock per outlet. Null when the user may not see stock. */
  stock: Array<{ outlet_id: string; name: string; quantity: number }> | null;
  canManage: boolean;
  canViewCost: boolean;
  /** False for composition / unregistered businesses: bills carry no tax. */
  chargeTax: boolean;
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 sm:col-span-2">
      <label htmlFor={id} className="text-sm">
        {label}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

/** "Customer pays ₹X, of which GST ₹Y", computed with the same engine as the bill. */
function PriceHint({ control, chargeTax }: { control: Control<ProductFormInput>; chargeTax: boolean }) {
  const [salePrice, includesTax, gstRate, cessRate] = useWatch({
    control,
    name: ["sale_price", "price_includes_tax", "gst_rate", "cess_rate"],
  });
  const paise = rupeesToPaise(typeof salePrice === "number" ? salePrice : (salePrice ?? ""));
  if (paise === null || paise <= 0) return null;

  let text: string;
  try {
    const totals = computeInvoice({
      lines: [
        {
          quantity: 1,
          unitPricePaise: paise,
          priceIncludesTax: !!includesTax,
          gstRate: String(gstRate ?? "").trim() === "" ? 0 : gstRate,
          cessRate: String(cessRate ?? "").trim() === "" ? 0 : (cessRate ?? 0),
        },
      ],
      chargeTax,
      isInterState: false,
      roundOff: false,
    });
    const gst = totals.cgstPaise + totals.sgstPaise + totals.igstPaise;
    if (!chargeTax) {
      text = `Customer pays ${formatINR(totals.totalPaise)}. No tax is added on bills.`;
    } else {
      text = `Customer pays ${formatINR(totals.totalPaise)}, of which GST ${formatINR(gst)}`;
      if (totals.cessPaise > 0) text += ` and cess ${formatINR(totals.cessPaise)}`;
      text += ".";
    }
  } catch {
    return null;
  }
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-sm sm:col-span-2" aria-live="polite">
      {text}
    </p>
  );
}

export function ProductForm({
  productId,
  defaults,
  categories: initialCategories,
  units,
  gstRates,
  outlets,
  stock,
  canManage,
  canViewCost,
  chargeTax,
}: ProductFormProps) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [categories, setCategories] = useState(initialCategories);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const isNew = productId === null;

  const form = useForm<ProductFormInput>({
    // raw: the Server Action parses the same rupee strings again, so submit them unparsed.
    resolver: zodResolver(productSchema, undefined, { raw: true }),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const trackInventory = useWatch({ control: form.control, name: "track_inventory" });

  function submit(values: ProductFormInput) {
    const payload: ProductFormInput = {
      ...values,
      id: productId,
      purchase_price: canViewCost ? values.purchase_price : undefined,
      opening_stock: isNew && values.track_inventory ? values.opening_stock : undefined,
    };
    run(() => saveProductAction(payload), {
      onSuccess: (result) => {
        for (const warning of result.warnings) toast.warning(warning);
        toast.success(isNew ? "Product added" : "Product saved");
        if (isNew) router.push("/app/products");
        else router.refresh();
      },
      onError: (_error, fieldErrors) => {
        for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
          if (name !== "_form" && messages[0]) form.setError(name as keyof ProductFormInput, { message: messages[0] });
        }
      },
    });
  }

  return (
    <>
      <form noValidate onSubmit={form.handleSubmit(submit)}>
        <fieldset disabled={!canManage} className="grid min-w-0 gap-4">
          <Section title="Basics">
            <Field label="Product name" htmlFor="name" required error={errors.name?.message} className="sm:col-span-2">
              <Input id="name" autoFocus={isNew} maxLength={150} aria-invalid={!!errors.name} {...form.register("name")} />
            </Field>
            <Field label="SKU" htmlFor="sku" error={errors.sku?.message} hint="Your own item code. Must be unique.">
              <Input id="sku" maxLength={64} className="tabular" aria-invalid={!!errors.sku} {...form.register("sku")} />
            </Field>
            <Field
              label="Barcode"
              htmlFor="barcode"
              error={errors.barcode?.message}
              hint="Click here and scan the item, or type the number."
            >
              <Input
                id="barcode"
                maxLength={64}
                className="tabular"
                autoComplete="off"
                aria-invalid={!!errors.barcode}
                {...form.register("barcode")}
                onKeyDown={(e) => {
                  // Scanners type the code and then press Enter: keep the form open and move on.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    form.setFocus("category_id");
                  }
                }}
              />
            </Field>
            <Field label="Category" htmlFor="category_id" error={errors.category_id?.message}>
              <div className="flex gap-2">
                <NativeSelect id="category_id" {...form.register("category_id")}>
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
                {canManage ? (
                  <Button type="button" variant="outline" onClick={() => setCategoryDialog(true)}>
                    <Plus aria-hidden /> New
                  </Button>
                ) : null}
              </div>
            </Field>
            <Field label="Unit" htmlFor="unit_code" required error={errors.unit_code?.message}>
              <NativeSelect id="unit_code" {...form.register("unit_code")}>
                {units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name} ({u.code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </Section>

          <Section
            title="Tax"
            description={
              chargeTax
                ? undefined
                : "Your business does not charge GST on bills right now. You can still save the HSN and GST rate so they are ready if you register later."
            }
          >
            <Field label="HSN code" htmlFor="hsn_code" error={errors.hsn_code?.message} hint="4, 6 or 8 digits">
              <Input
                id="hsn_code"
                inputMode="numeric"
                maxLength={8}
                className="tabular"
                aria-invalid={!!errors.hsn_code}
                {...form.register("hsn_code")}
              />
            </Field>
            <Field label="GST rate" htmlFor="gst_rate" required error={errors.gst_rate ? "Select a GST rate" : null}>
              <NativeSelect id="gst_rate" aria-invalid={!!errors.gst_rate} {...form.register("gst_rate")}>
                <option value="">Select GST rate</option>
                {gstRates.map((r) => (
                  <option key={r.rate} value={String(r.rate)}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Cess rate (%)"
              htmlFor="cess_rate"
              error={errors.cess_rate?.message}
              hint="Compensation cess. Leave at 0 unless your CA says otherwise."
            >
              <Input
                id="cess_rate"
                inputMode="decimal"
                className="tabular"
                aria-invalid={!!errors.cess_rate}
                {...form.register("cess_rate")}
              />
            </Field>
          </Section>

          <Section title="Pricing">
            <Field label="Selling price" htmlFor="sale_price" required error={errors.sale_price?.message}>
              <MoneyInput id="sale_price" aria-invalid={!!errors.sale_price} {...form.register("sale_price")} />
            </Field>
            <Field label="MRP" htmlFor="mrp" error={errors.mrp?.message} hint="Printed maximum retail price, if any">
              <MoneyInput id="mrp" aria-invalid={!!errors.mrp} {...form.register("mrp")} />
            </Field>
            <Controller
              control={form.control}
              name="price_includes_tax"
              render={({ field }) => (
                <ToggleRow
                  id="price_includes_tax"
                  label="Price includes tax"
                  hint="On: the selling price already contains GST (like an MRP). Off: GST is added on top."
                  checked={!!field.value}
                  onChange={field.onChange}
                  disabled={!canManage}
                />
              )}
            />
            <PriceHint control={form.control} chargeTax={chargeTax} />
            {canViewCost ? (
              <Field
                label="Purchase price"
                htmlFor="purchase_price"
                error={errors.purchase_price?.message}
                hint="What you pay for it. Only people allowed to see cost can view this."
              >
                <MoneyInput
                  id="purchase_price"
                  aria-invalid={!!errors.purchase_price}
                  {...form.register("purchase_price")}
                />
              </Field>
            ) : null}
          </Section>

          <Section title="Stock">
            <Controller
              control={form.control}
              name="track_inventory"
              render={({ field }) => (
                <ToggleRow
                  id="track_inventory"
                  label="Track stock for this product"
                  hint="Turn off for services or items you do not count."
                  checked={!!field.value}
                  onChange={field.onChange}
                  disabled={!canManage}
                />
              )}
            />
            {trackInventory ? (
              <Field
                label="Low stock alert at"
                htmlFor="low_stock_threshold"
                error={errors.low_stock_threshold?.message}
                hint="Shows a Low stock badge when stock is at or below this number."
              >
                <Input
                  id="low_stock_threshold"
                  inputMode="decimal"
                  className="tabular"
                  aria-invalid={!!errors.low_stock_threshold}
                  {...form.register("low_stock_threshold")}
                />
              </Field>
            ) : null}

            {isNew && trackInventory && outlets.length > 0 ? (
              <div className="grid gap-3 sm:col-span-2">
                <p className="text-sm font-medium">
                  Opening stock
                  <span className="block text-xs font-normal text-muted-foreground">
                    How many you have right now. Leave blank for none.
                  </span>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {outlets.map((o, i) => (
                    <Field
                      key={o.id}
                      label={o.name}
                      htmlFor={`opening_stock_${i}`}
                      error={errors.opening_stock?.[i]?.quantity?.message}
                    >
                      <Input
                        id={`opening_stock_${i}`}
                        inputMode="decimal"
                        className="tabular"
                        placeholder="0"
                        {...form.register(`opening_stock.${i}.quantity`)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ) : null}

            {!isNew && stock && trackInventory ? (
              <div className="sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Current stock</p>
                  <Link
                    href={`/app/inventory?product=${productId}`}
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    View stock history
                  </Link>
                </div>
                <ul className="mt-2 divide-y rounded-lg border">
                  {stock.map((s) => (
                    <li key={s.outlet_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="tabular font-medium">{formatQty(s.quantity)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Stock changes through bills, purchases and stock adjustments.
                </p>
              </div>
            ) : null}
          </Section>

          <Section title="Status">
            <Controller
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <ToggleRow
                  id="is_active"
                  label="Active"
                  hint="Inactive products are hidden from billing but stay on old bills and reports."
                  checked={!!field.value}
                  onChange={field.onChange}
                  disabled={!canManage}
                />
              )}
            />
          </Section>
        </fieldset>

        {canManage ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <SubmitButton size="lg" pending={pending} pendingText="Saving…">
              {isNew ? "Add product" : "Save changes"}
            </SubmitButton>
            <Button type="button" variant="ghost" size="lg" asChild>
              <Link href="/app/products">Cancel</Link>
            </Button>
          </div>
        ) : null}
      </form>

      {canManage ? (
        <NewCategoryDialog
          open={categoryDialog}
          onOpenChange={setCategoryDialog}
          parents={categories.filter((c) => c.parent_id === null)}
          onCreated={(category) => {
            setCategories((list) => [...list, category].sort((a, b) => a.label.localeCompare(b.label)));
            form.setValue("category_id", category.id, { shouldDirty: true });
          }}
        />
      ) : null}
    </>
  );
}

function NewCategoryDialog({
  open,
  onOpenChange,
  parents,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parents: ProductFormCategory[];
  onCreated: (category: ProductFormCategory) => void;
}) {
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Not a <form>: this dialog renders inside the product form's React tree, and
  // a nested submit event would bubble up and submit the product as well.
  function create() {
    if (!name.trim()) {
      setError("Category name is required");
      return;
    }
    run(() => saveCategoryAction({ name, parent_id: parentId || null }), {
      silentError: true,
      onSuccess: (row) => {
        const parent = parents.find((p) => p.id === row.parent_id);
        onCreated({
          id: row.id,
          label: parent ? `${parent.label} › ${row.name}` : row.name,
          parent_id: row.parent_id,
        });
        toast.success("Category added");
        setName("");
        setParentId("");
        setError(null);
        onOpenChange(false);
      },
      onError: (message) => setError(message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New category</DialogTitle>
          <DialogDescription>Group similar products so they are easier to find.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Category name" htmlFor="new_category_name" required error={error}>
            <Input
              id="new_category_name"
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  create();
                }
              }}
            />
          </Field>
          {parents.length > 0 ? (
            <Field label="Inside" htmlFor="new_category_parent" hint="Optional. Pick a category to make this a sub-category.">
              <NativeSelect id="new_category_parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">Top level</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton type="button" pending={pending} onClick={create}>
            Add category
          </SubmitButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
