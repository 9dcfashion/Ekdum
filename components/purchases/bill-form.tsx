"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Info, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { savePurchaseBillAction } from "@/app/app/(shell)/purchases/actions";
import { roundOffToRupee, stateName } from "@/lib/gst";
import { Decimal, formatINR, paiseToRupees } from "@/lib/money";
import { liveTotals, resolvePurchaseSupply } from "@/lib/purchases/compute";
import { prefillLineToForm } from "@/lib/purchases/prefill";
import type { GstRateOption, OutletOption, PurchaseProductOption, UnitOption, VendorOption } from "@/lib/purchases/types";
import { purchaseBillSchema, type PurchaseBillData, type PurchaseBillInput } from "@/lib/validation/purchases";
import { AttachmentsField } from "./attachments-field";
import { applyFieldErrors, callAction } from "./form-helpers";
import { ProductPicker } from "./product-picker";
import { QuickProductDialog, QuickVendorDialog } from "./quick-create-dialogs";
import { VendorPicker } from "./vendor-picker";

export interface BillFormProps {
  businessId: string;
  /** Built from a DraftPrefill on the server (see lib/purchases/prefill.ts). */
  defaults: PurchaseBillInput;
  outlets: OutletOption[];
  vendors: VendorOption[];
  units: UnitOption[];
  gstRates: GstRateOption[];
  attachmentUrls: Record<string, string>;
  /** Today in IST (YYYY-MM-DD): the latest allowed bill date. */
  today: string;
  canPost: boolean;
  canCreateVendor: boolean;
  canCreateProduct: boolean;
}

export function BillForm(props: BillFormProps) {
  const { outlets, units, gstRates } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [vendors, setVendors] = useState(props.vendors);
  const [vendorDialog, setVendorDialog] = useState<string | null>(null);
  const [productDialog, setProductDialog] = useState<string | null>(null);

  const form = useForm<PurchaseBillInput, unknown, PurchaseBillData>({
    resolver: zodResolver(purchaseBillSchema),
    defaultValues: props.defaults,
  });
  const { control } = form;
  const { errors } = form.formState;
  const lineFields = useFieldArray({ control, name: "lines" });

  const lines = useWatch({ control, name: "lines" });
  const isInterState = useWatch({ control, name: "is_inter_state" });
  const roundOff = useWatch({ control, name: "round_off" });
  const vendorId = useWatch({ control, name: "vendor_id" }) ?? "";
  const outletId = useWatch({ control, name: "outlet_id" });
  const attachmentPaths = useWatch({ control, name: "attachment_paths" });

  const isEdit = !!props.defaults.id;
  const outlet = outlets.find((o) => o.id === outletId) ?? outlets[0];
  const vendor = vendors.find((v) => v.id === vendorId) ?? null;
  const supply = resolvePurchaseSupply(outlet.ourState, vendor);
  const totals = liveTotals(lines ?? [], !!isInterState, roundOff);

  /** Re-suggest CGST+SGST vs IGST when the vendor or the outlet changes. The user can still flip it. */
  function suggestTaxType(nextOutletId: string, nextVendorId: string) {
    const o = outlets.find((x) => x.id === nextOutletId);
    const v = vendors.find((x) => x.id === nextVendorId) ?? null;
    if (!o) return;
    form.setValue("is_inter_state", resolvePurchaseSupply(o.ourState, v).isInterState, { shouldDirty: true });
  }

  function chooseVendor(id: string, list: VendorOption[] = vendors) {
    form.setValue("vendor_id", id, { shouldDirty: true });
    form.clearErrors("vendor_id");
    const o = outlets.find((x) => x.id === form.getValues("outlet_id"));
    const v = list.find((x) => x.id === id) ?? null;
    if (o) form.setValue("is_inter_state", resolvePurchaseSupply(o.ourState, v).isInterState, { shouldDirty: true });
  }

  function addProduct(product: PurchaseProductOption) {
    const current = form.getValues("lines");
    const index = current.findIndex((l) => l.product_id === product.id);
    form.clearErrors("lines");
    if (index >= 0) {
      let next = "1";
      try {
        next = new Decimal(String(current[index].quantity || 0)).plus(1).toString();
      } catch {
        // keep "1" when the quantity box holds something unreadable
      }
      form.setValue(`lines.${index}.quantity`, next, { shouldDirty: true });
      toast.success(`${product.name}: quantity ${next}`);
      return;
    }
    lineFields.append(
      prefillLineToForm({
        product_id: product.id,
        description: product.name,
        hsn_code: product.hsn_code,
        quantity: 1,
        unit_code: product.unit_code,
        rate_paise: product.cost_paise,
        gst_rate: product.gst_rate,
        cess_rate: product.cess_rate,
      }),
      { shouldFocus: false },
    );
  }

  function addFreeText(description: string) {
    form.clearErrors("lines");
    lineFields.append(prefillLineToForm({ description, quantity: 1, unit_code: units.some((u) => u.code === "NOS") ? "NOS" : (units[0]?.code ?? "PCS") }), {
      shouldFocus: !description,
    });
  }

  async function save(post: boolean) {
    form.clearErrors();
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Please check the highlighted fields");
      return;
    }
    const values = form.getValues();
    if (post) {
      const missing: Array<[Parameters<typeof form.setError>[0], string]> = [];
      if (!values.vendor_id) missing.push(["vendor_id", "Select a vendor before posting"]);
      if (!values.vendor_invoice_number?.trim()) missing.push(["vendor_invoice_number", "Enter the vendor's bill number before posting"]);
      if (!values.vendor_invoice_date) missing.push(["vendor_invoice_date", "Enter the bill date before posting"]);
      if (values.lines.length === 0) missing.push(["lines", "Add at least one item before posting"]);
      if (missing.length > 0) {
        for (const [name, message] of missing) form.setError(name, { message });
        toast.error(missing[0][1]);
        return;
      }
    }
    // Send what was typed, not the parsed values: the server parses with the same schema.
    const result = await callAction(() => savePurchaseBillAction(values, post));
    if (!result.ok) {
      toast.error(result.error);
      applyFieldErrors(form.setError, result.fieldErrors);
      return;
    }
    if (result.data.postError) toast.error(`Saved as a draft, but it could not be posted: ${result.data.postError}`);
    else toast.success(result.data.posted ? "Purchase bill posted. Stock is updated." : "Draft saved");
    router.push(`/app/purchases/${result.data.id}`);
  }

  const busy = pending || uploading;
  const linesError = errors.lines?.message ?? errors.lines?.root?.message;
  const suggestionOverridden = supply.vendorState !== null && supply.isInterState !== !!isInterState;

  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(() => save(false));
        }}
        onKeyDown={(e) => {
          // A barcode scanner (or a stray Enter) in a text box must not submit the whole bill.
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
        }}
        className="grid gap-5"
      >
        <section className="rounded-xl border p-4" aria-labelledby="bill-attachments">
          <h2 id="bill-attachments" className="mb-3 text-sm font-semibold">
            Vendor&apos;s bill
          </h2>
          <AttachmentsField
            businessId={props.businessId}
            paths={attachmentPaths ?? []}
            onChange={(paths) => form.setValue("attachment_paths", paths, { shouldDirty: true })}
            initialUrls={props.attachmentUrls}
            onBusyChange={setUploading}
          />
          {errors.attachment_paths?.message ? (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {errors.attachment_paths.message}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border p-4" aria-labelledby="bill-details">
          <h2 id="bill-details" className="mb-3 text-sm font-semibold">
            Bill details
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Vendor" htmlFor="vendor_id" error={errors.vendor_id?.message} className="sm:col-span-2">
              <VendorPicker
                id="vendor_id"
                vendors={vendors}
                value={vendorId}
                onChange={(id) => chooseVendor(id)}
                onCreate={props.canCreateVendor ? (name) => setVendorDialog(name) : undefined}
                invalid={!!errors.vendor_id}
              />
            </Field>
            <Field label="Vendor's bill number" htmlFor="vendor_invoice_number" error={errors.vendor_invoice_number?.message}>
              <Input id="vendor_invoice_number" autoComplete="off" maxLength={50} className="tabular" aria-invalid={!!errors.vendor_invoice_number || undefined} {...form.register("vendor_invoice_number")} />
            </Field>
            <Field label="Bill date" htmlFor="vendor_invoice_date" error={errors.vendor_invoice_date?.message}>
              <Input id="vendor_invoice_date" type="date" max={props.today} aria-invalid={!!errors.vendor_invoice_date || undefined} {...form.register("vendor_invoice_date")} />
            </Field>
            <Field label="Received at outlet" htmlFor="outlet_id" required error={errors.outlet_id?.message} hint="Stock is added here when the bill is posted" className="sm:col-span-2">
              <NativeSelect
                id="outlet_id"
                {...form.register("outlet_id", { onChange: (e) => suggestTaxType(String(e.target.value), form.getValues("vendor_id") ?? "") })}
              >
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">GST charged on this bill</legend>
              <div className="flex flex-wrap gap-2">
                {[
                  { inter: false, label: "CGST + SGST", sub: "Vendor in the same state" },
                  { inter: true, label: "IGST", sub: "Vendor in another state" },
                ].map((option) => (
                  <label
                    key={option.label}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="tax_type"
                      className="mt-0.5 accent-[var(--primary)]"
                      checked={!!isInterState === option.inter}
                      onChange={() => form.setValue("is_inter_state", option.inter, { shouldDirty: true })}
                    />
                    <span>
                      {option.label}
                      <span className="block text-xs text-muted-foreground">{option.sub}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  {supply.vendorState === null
                    ? `Place of supply is ${stateName(supply.ourState)}. We could not tell the vendor's state, so pick what the vendor's bill shows.`
                    : supply.isInterState
                      ? `Vendor is in ${stateName(supply.vendorState)} and this outlet is in ${stateName(supply.ourState)}, so IGST normally applies.`
                      : `Vendor and this outlet are both in ${stateName(supply.ourState)}, so CGST + SGST normally applies.`}
                  {suggestionOverridden ? " You have chosen differently. Keep it only if that is what the vendor's bill shows." : ""}
                </span>
              </p>
            </fieldset>
          </div>
        </section>

        <section className="rounded-xl border p-4" aria-labelledby="bill-items">
          <h2 id="bill-items" className="mb-3 text-sm font-semibold">
            Items
          </h2>

          {lineFields.fields.length > 0 ? (
            <ol className="mb-4 grid gap-3">
              {lineFields.fields.map((field, i) => {
                const e = errors.lines?.[i];
                const line = lines?.[i];
                const result = totals.lines[i] ?? null;
                const rateValueNow = String(line?.gst_rate ?? "");
                const rateListed = gstRates.some((r) => String(r.rate) === rateValueNow);
                const unitNow = String(line?.unit_code ?? "");
                const unitListed = units.some((u) => u.code === unitNow);
                const p = `line-${field.id}`;
                return (
                  <li key={field.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        Line {i + 1} · {line?.product_id ? "Stock item" : "Expense line (no stock)"}
                      </span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${i + 1}`} onClick={() => lineFields.remove(i)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-12">
                      <Field label="Item" htmlFor={`${p}-desc`} error={e?.description?.message} className="col-span-2 sm:col-span-3 lg:col-span-5">
                        <Input id={`${p}-desc`} autoComplete="off" aria-invalid={!!e?.description || undefined} {...form.register(`lines.${i}.description`)} />
                      </Field>
                      <Field label="HSN" htmlFor={`${p}-hsn`} error={e?.hsn_code?.message} className="lg:col-span-2">
                        <Input id={`${p}-hsn`} inputMode="numeric" maxLength={8} autoComplete="off" className="tabular" aria-invalid={!!e?.hsn_code || undefined} {...form.register(`lines.${i}.hsn_code`)} />
                      </Field>
                      <Field label="Quantity" htmlFor={`${p}-qty`} error={e?.quantity?.message} className="lg:col-span-2">
                        <Input id={`${p}-qty`} inputMode="decimal" autoComplete="off" className="tabular" aria-invalid={!!e?.quantity || undefined} {...form.register(`lines.${i}.quantity`)} />
                      </Field>
                      <Field label="Unit" htmlFor={`${p}-unit`} error={e?.unit_code?.message} className="lg:col-span-3">
                        <NativeSelect id={`${p}-unit`} {...form.register(`lines.${i}.unit_code`)}>
                          {unitListed || !unitNow ? null : <option value={unitNow}>{unitNow}</option>}
                          {units.map((u) => (
                            <option key={u.code} value={u.code}>
                              {u.name} ({u.code})
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Rate per unit" htmlFor={`${p}-rate`} error={e?.rate?.message} className="lg:col-span-3">
                        <MoneyInput id={`${p}-rate`} aria-invalid={!!e?.rate || undefined} {...form.register(`lines.${i}.rate`)} />
                      </Field>
                      <Field label="Discount" htmlFor={`${p}-disc`} error={e?.discount?.message} className="lg:col-span-3">
                        <MoneyInput id={`${p}-disc`} placeholder="0.00" aria-invalid={!!e?.discount || undefined} {...form.register(`lines.${i}.discount`)} />
                      </Field>
                      <Field label="GST rate" htmlFor={`${p}-gst`} error={e?.gst_rate?.message} className="lg:col-span-4">
                        <NativeSelect id={`${p}-gst`} {...form.register(`lines.${i}.gst_rate`)}>
                          {rateListed || !rateValueNow ? null : <option value={rateValueNow}>{rateValueNow}%</option>}
                          {gstRates.map((r) => (
                            <option key={r.rate} value={String(r.rate)}>
                              {r.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Cess %" htmlFor={`${p}-cess`} error={e?.cess_rate?.message} className="lg:col-span-2">
                        <Input id={`${p}-cess`} inputMode="decimal" autoComplete="off" className="tabular" aria-invalid={!!e?.cess_rate || undefined} {...form.register(`lines.${i}.cess_rate`)} />
                      </Field>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" className="accent-[var(--primary)]" {...form.register(`lines.${i}.price_includes_tax`)} />
                        Rate includes tax
                      </label>
                      {result ? (
                        <p className="tabular text-sm">
                          <span className="text-muted-foreground">
                            Taxable {formatINR(result.taxablePaise)} + tax {formatINR(result.totalPaise - result.taxablePaise)} ={" "}
                          </span>
                          <span className="font-medium">{formatINR(result.totalPaise)}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Fill in quantity and rate to see the amount</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">No items yet. Search for a product below, or add an expense line such as freight.</p>
          )}

          <ProductPicker
            onPick={addProduct}
            onCreate={props.canCreateProduct ? (name) => setProductDialog(name) : undefined}
            onAddFreeText={addFreeText}
          />
          <div className="mt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => addFreeText("")}>
              <Plus aria-hidden /> Add expense line (no stock)
            </Button>
          </div>
          {linesError ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {linesError}
            </p>
          ) : null}
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <section className="rounded-xl border p-4">
            <Field label="Notes" htmlFor="notes" error={errors.notes?.message} hint="Only for your own records">
              <Textarea id="notes" rows={3} maxLength={1000} {...form.register("notes")} />
            </Field>
          </section>

          <section className="rounded-xl border p-4" aria-labelledby="bill-totals">
            <h2 id="bill-totals" className="mb-3 text-sm font-semibold">
              Totals
            </h2>
            <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Taxable value</dt>
              <dd className="text-right">{formatINR(totals.taxablePaise)}</dd>
              {isInterState ? (
                <>
                  <dt className="text-muted-foreground">IGST</dt>
                  <dd className="text-right">{formatINR(totals.igstPaise)}</dd>
                </>
              ) : (
                <>
                  <dt className="text-muted-foreground">CGST</dt>
                  <dd className="text-right">{formatINR(totals.cgstPaise)}</dd>
                  <dt className="text-muted-foreground">SGST</dt>
                  <dd className="text-right">{formatINR(totals.sgstPaise)}</dd>
                </>
              )}
              {totals.cessPaise > 0 ? (
                <>
                  <dt className="text-muted-foreground">Cess</dt>
                  <dd className="text-right">{formatINR(totals.cessPaise)}</dd>
                </>
              ) : null}
            </dl>
            <div className="mt-3">
              <Field
                label="Round-off"
                htmlFor="round_off"
                error={errors.round_off?.message}
                hint="To match the vendor's printed total. Use a minus sign to round down. Up to 0.99 either way."
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <MoneyInput id="round_off" placeholder="0.00" aria-invalid={!!errors.round_off || undefined} {...form.register("round_off")} />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const adjust = roundOffToRupee(totals.beforeRoundOffPaise).roundOffPaise;
                      form.setValue("round_off", adjust === 0 ? "" : paiseToRupees(adjust), { shouldDirty: true, shouldValidate: true });
                    }}
                  >
                    Nearest rupee
                  </Button>
                </div>
              </Field>
            </div>
            <div className="tabular mt-3 flex items-baseline justify-between border-t pt-3">
              <span className="text-sm font-medium">Bill total</span>
              <span className="text-lg font-semibold">{formatINR(totals.totalPaise)}</span>
            </div>
            {totals.incompleteLines > 0 ? (
              <p className="mt-1 text-xs text-amber-700">
                {totals.incompleteLines === 1 ? "1 line is" : `${totals.incompleteLines} lines are`} not complete yet and not in this total.
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" asChild>
            <Link href={isEdit ? `/app/purchases/${props.defaults.id}` : "/app/purchases"}>Cancel</Link>
          </Button>
          <SubmitButton pending={pending} disabled={busy} variant={props.canPost ? "outline" : "default"} size="lg">
            Save draft
          </SubmitButton>
          {props.canPost ? (
            <ConfirmDialog
              trigger={
                <Button type="button" size="lg" disabled={busy}>
                  Save and post
                </Button>
              }
              title="Post this purchase bill?"
              description={`Posting adds the items to stock at ${outlet.name} and locks the bill. To change it afterwards you would have to cancel it and enter it again.`}
              confirmLabel="Save and post"
              onConfirm={() => save(true)}
            />
          ) : null}
        </div>
      </form>

      {/* Rendered outside the <form> so their own forms are never nested inside it. */}
      <QuickVendorDialog
        initialName={vendorDialog}
        onClose={() => setVendorDialog(null)}
        onCreated={(created) => {
          const next = [...vendors, created].sort((a, b) => a.name.localeCompare(b.name));
          setVendors(next);
          chooseVendor(created.id, next);
        }}
      />
      <QuickProductDialog
        initialName={productDialog}
        units={units}
        gstRates={gstRates}
        onClose={() => setProductDialog(null)}
        onCreated={addProduct}
      />
    </>
  );
}
