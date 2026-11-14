"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Info, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { savePurchaseBillAction } from "@/app/app/(shell)/purchases/actions";
import { addDays, formatDate } from "@/lib/dates";
import { stateName } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { liveTotals, resolvePurchaseSupply } from "@/lib/purchases/compute";
import {
  PURCHASE_STEPS,
  dateChoice,
  firstIncompleteStep,
  firstStepWithError,
  isBlankBill,
  isPhotoOnly,
  parseStep,
  stepCompleteness,
  stepForField,
  stepQuantity,
  supplierStepProblems,
  type PurchaseStep,
  type StepCompleteness,
} from "@/lib/purchases/flow";
import { EMPTY_PREFILL, prefillLineToForm, prefillToFormValues } from "@/lib/purchases/prefill";
import type { GstRateOption, OutletOption, PurchaseProductOption, UnitOption, VendorOption } from "@/lib/purchases/types";
import { cn } from "@/lib/utils";
import { purchaseBillSchema, type PurchaseBillData, type PurchaseBillInput } from "@/lib/validation/purchases";
import { AttachmentsField, PhotoStrip } from "./attachments-field";
import { applyFieldErrors, callAction } from "./form-helpers";
import { ItemCard } from "./item-card";
import { ProductPicker } from "./product-picker";
import { QuickProductDialog, QuickVendorDialog } from "./quick-create-dialogs";
import { StepCheck } from "./step-check";
import { useLeaveGuard } from "./use-leave-guard";
import { SupplierPicker } from "./vendor-picker";

export interface PurchaseFlowProps {
  businessId: string;
  /** Built from a DraftPrefill on the server (see lib/purchases/prefill.ts). */
  defaults: PurchaseBillInput;
  outlets: OutletOption[];
  vendors: VendorOption[];
  /** Vendor ids of the latest purchase bills, newest first. */
  recentVendorIds: string[];
  units: UnitOption[];
  gstRates: GstRateOption[];
  attachmentUrls: Record<string, string>;
  /** Today in IST (YYYY-MM-DD): the latest allowed bill date. */
  today: string;
  canPost: boolean;
  canCreateVendor: boolean;
  canCreateProduct: boolean;
  /** Where Cancel goes. */
  exitHref: string;
}

/**
 * Guided purchase entry: 1 Photo · 2 Supplier · 3 Items · 4 Save.
 * "Add another purchase" starts a fresh flow without reloading the page.
 */
export function PurchaseEntry(props: PurchaseFlowProps) {
  const router = useRouter();
  const [instance, setInstance] = useState(0);
  const [vendors, setVendors] = useState(props.vendors);
  const [recentVendorIds, setRecentVendorIds] = useState(props.recentVendorIds);
  const fresh = instance > 0;
  const blank = useMemo(
    () => prefillToFormValues(EMPTY_PREFILL, { outletId: props.defaults.outlet_id, isInterState: false }),
    [props.defaults.outlet_id],
  );

  return (
    <PurchaseFlow
      key={instance}
      {...props}
      defaults={fresh ? blank : props.defaults}
      attachmentUrls={fresh ? {} : props.attachmentUrls}
      vendors={vendors}
      recentVendorIds={recentVendorIds}
      onVendorCreated={(vendor) => setVendors((list) => [...list, vendor].sort((a, b) => a.name.localeCompare(b.name)))}
      onSaved={(vendorId) => {
        if (vendorId) setRecentVendorIds((ids) => [vendorId, ...ids]);
      }}
      onAddAnother={() => {
        if (props.defaults.id && !fresh) router.push("/app/purchases/new");
        else setInstance((i) => i + 1);
      }}
    />
  );
}

interface Done {
  id: string;
  posted: boolean;
  postError: string | null;
  vendorName: string | null;
  number: string;
  totalPaise: number;
}

type SaveKind = "photo" | "draft" | "post";

const STEP_TITLES: Record<PurchaseStep, { title: string; hint: string }> = {
  1: { title: "Photo of the bill", hint: "Take a clear photo of the supplier's bill. It helps whoever checks it later." },
  2: { title: "Supplier and bill", hint: "Who sent the goods, and the number and date printed on their bill." },
  3: { title: "Items", hint: "Tap each item on the bill, then type the quantity and rate." },
  4: { title: "Check and save", hint: "Check the total against the paper bill, then save." },
};

function setStepInUrl(step: PurchaseStep, mode: "push" | "replace") {
  const params = new URLSearchParams(window.location.search);
  params.set("step", String(step));
  // Next.js syncs native history calls with useSearchParams, so the phone's back button steps back through the flow.
  if (mode === "push") window.history.pushState(null, "", `?${params}`);
  else window.history.replaceState(null, "", `?${params}`);
}

/** Scroll to a step: on a phone it is the only one showing, so go to the top; on a computer scroll to its section. */
function revealStep(n: PurchaseStep) {
  const section = document.getElementById(`purchase-step-${n}`);
  if (!section) return;
  if (window.matchMedia("(min-width: 1024px)").matches) section.scrollIntoView({ block: "start", behavior: "smooth" });
  else window.scrollTo({ top: 0 });
  section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

function PurchaseFlow(
  props: PurchaseFlowProps & {
    onVendorCreated: (vendor: VendorOption) => void;
    onSaved: (vendorId: string | null) => void;
    onAddAnother: () => void;
  },
) {
  const { outlets, units, gstRates, vendors, today, canPost } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [startStep] = useState(() => firstIncompleteStep(props.defaults));
  const step: PurchaseStep = parseStep(searchParams.get("step")) ?? startStep;
  /** History entries this flow has pushed and not yet gone back over. */
  const depth = useRef(0);
  /** The step last scrolled to, so a change of step (and only that) scrolls the page. */
  const shownStep = useRef(step);

  const form = useForm<PurchaseBillInput, unknown, PurchaseBillData>({
    resolver: zodResolver(purchaseBillSchema),
    defaultValues: props.defaults,
    mode: "onTouched",
  });
  const { control } = form;
  const { errors, isDirty } = form.formState;
  const lineFields = useFieldArray({ control, name: "lines" });

  const lines = useWatch({ control, name: "lines" });
  const isInterState = useWatch({ control, name: "is_inter_state" });
  const roundOff = useWatch({ control, name: "round_off" });
  const vendorId = useWatch({ control, name: "vendor_id" }) ?? "";
  const billNumber = useWatch({ control, name: "vendor_invoice_number" }) ?? "";
  const billDate = useWatch({ control, name: "vendor_invoice_date" }) ?? "";
  const outletId = useWatch({ control, name: "outlet_id" });
  const attachmentPaths = useWatch({ control, name: "attachment_paths" });

  const [urls, setUrls] = useState(props.attachmentUrls);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState<SaveKind | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [confirmPost, setConfirmPost] = useState(false);
  const [vendorDialog, setVendorDialog] = useState<string | null>(null);
  const [productDialog, setProductDialog] = useState<string | null>(null);
  const [lastRates, setLastRates] = useState<Record<string, number | null>>({});
  const [paperTotal, setPaperTotal] = useState("");
  const [taxTypeOpen, setTaxTypeOpen] = useState(false);

  const guard = useLeaveGuard(isDirty && !done);

  // A fresh page always opens at its own first step, whatever ?step= the URL still carries.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("step") !== String(startStep)) setStepInUrl(startStep, "replace");
  }, [startStep]);

  useEffect(() => {
    const onPop = () => {
      depth.current = Math.max(0, depth.current - 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    revealStep(step);
  }, [step]);

  const outlet = outlets.find((o) => o.id === outletId) ?? outlets[0];
  const vendor = vendors.find((v) => v.id === vendorId) ?? null;
  const supply = resolvePurchaseSupply(outlet.ourState, vendor);
  const totals = liveTotals(lines ?? [], !!isInterState, roundOff);
  const bill = { id: props.defaults.id, vendor_id: vendorId, vendor_invoice_number: billNumber, vendor_invoice_date: billDate, attachment_paths: attachmentPaths, lines };
  const completeness = stepCompleteness(bill);
  const photoOnly = isPhotoOnly(bill);
  const blank = isBlankBill(bill);
  const busy = uploading || saving !== null;
  const lineCount = lines?.length ?? 0;
  const inBill = Object.fromEntries((lines ?? []).filter((l) => l?.product_id).map((l) => [String(l.product_id), String(l.quantity ?? "")]));

  function goTo(next: PurchaseStep) {
    if (next === step) {
      revealStep(next);
      return;
    }
    setStepInUrl(next, "push");
    depth.current += 1;
  }

  function goBack() {
    if (step === 1) {
      guard.requestLeave(props.exitHref);
      return;
    }
    if (depth.current > 0) window.history.back();
    else setStepInUrl((step - 1) as PurchaseStep, "replace");
  }

  function chooseVendor(id: string, list: VendorOption[] = vendors) {
    form.setValue("vendor_id", id, { shouldDirty: true });
    form.clearErrors("vendor_id");
    const o = outlets.find((x) => x.id === form.getValues("outlet_id"));
    const v = list.find((x) => x.id === id) ?? null;
    if (o) form.setValue("is_inter_state", resolvePurchaseSupply(o.ourState, v).isInterState, { shouldDirty: true });
  }

  function suggestTaxType(nextOutletId: string) {
    const o = outlets.find((x) => x.id === nextOutletId);
    if (o) form.setValue("is_inter_state", resolvePurchaseSupply(o.ourState, vendor).isInterState, { shouldDirty: true });
  }

  function setDate(value: string) {
    form.setValue("vendor_invoice_date", value, { shouldDirty: true, shouldValidate: true });
  }

  /** Add a product, or one more of it when it is already on the bill. Returns what happened, for the scanner. */
  function addProduct(product: PurchaseProductOption, scanned = false): string {
    setLastRates((rates) => ({ ...rates, [product.id]: product.cost_paise }));
    const current = form.getValues("lines");
    const index = current.findIndex((l) => l.product_id === product.id);
    if (current.length === 0) form.clearErrors("lines"); // only the "add at least one item" message
    if (index >= 0) {
      const next = stepQuantity(current[index].quantity, 1);
      form.setValue(`lines.${index}.quantity`, next, { shouldDirty: true });
      const message = `${product.name}: qty is now ${next}`;
      if (!scanned) toast.success(message);
      return message;
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
      scanned ? { shouldFocus: false } : { shouldFocus: true, focusName: `lines.${current.length}.quantity` },
    );
    return `Added ${product.name}`;
  }

  function addExpense(description: string) {
    const index = form.getValues("lines").length;
    if (index === 0) form.clearErrors("lines");
    const unit = units.some((u) => u.code === "NOS") ? "NOS" : (units[0]?.code ?? "PCS");
    lineFields.append(prefillLineToForm({ description, quantity: 1, unit_code: unit }), {
      shouldFocus: true,
      focusName: description ? `lines.${index}.rate` : `lines.${index}.description`,
    });
  }

  function removeLine(index: number) {
    const removed = form.getValues(`lines.${index}`);
    lineFields.remove(index);
    toast(`Removed ${String(removed.description ?? "").trim() || "the item"}`, {
      duration: 7000,
      action: {
        label: "Undo",
        onClick: () => lineFields.insert(Math.min(index, form.getValues("lines").length), removed, { shouldFocus: false }),
      },
    });
  }

  async function next() {
    if (step === 1) {
      goTo(2);
      return;
    }
    if (step === 2) {
      const valid = await form.trigger(["vendor_invoice_number", "vendor_invoice_date", "outlet_id"]);
      const problems = Object.entries(supplierStepProblems(form.getValues()));
      for (const [name, message] of problems) form.setError(name as "vendor_id", { message });
      if (!valid || problems.length > 0) {
        toast.error(problems[0]?.[1] ?? "Please check the fields marked in red");
        revealStep(2);
        return;
      }
      goTo(3);
      return;
    }
    if (step === 3) {
      if (form.getValues("lines").length === 0) {
        form.setError("lines", { message: "Add at least one item from the bill" });
        toast.error("Add at least one item from the bill");
        return;
      }
      if (!(await form.trigger("lines"))) {
        toast.error("Please fix the items marked in red");
        // After React has drawn the red fields.
        setTimeout(() => document.querySelector("[data-line-index] [aria-invalid='true']")?.scrollIntoView({ block: "center" }), 80);
        return;
      }
      goTo(4);
    }
  }

  /** Validate for a save. Returns the values to send, or null after pointing the user at the problem. */
  async function readyToSave(kind: SaveKind): Promise<PurchaseBillInput | null> {
    if (!(await form.trigger())) {
      // The schema itself says where the problems are (form state may not have re-rendered yet).
      const parsed = purchaseBillSchema.safeParse(form.getValues());
      const target = (parsed.success ? null : firstStepWithError(parsed.error.issues.map((i) => i.path.join(".")))) ?? step;
      toast.error(target === 3 ? "Please fix the items marked in red" : "Please check the fields marked in red");
      goTo(target);
      return null;
    }
    const values = form.getValues();
    if (kind === "post") {
      const problems: Array<[string, string]> = Object.entries(supplierStepProblems(values));
      if (values.lines.length === 0) problems.push(["lines", "Add at least one item from the bill"]);
      if (problems.length > 0) {
        for (const [name, message] of problems) form.setError(name as "vendor_id", { message });
        toast.error(`Before adding to stock: ${problems[0][1].toLowerCase()}`);
        goTo(stepForField(problems[0][0]));
        return null;
      }
    }
    return values;
  }

  async function save(kind: SaveKind) {
    if (busy) return;
    const values = await readyToSave(kind);
    if (!values) return;
    setSaving(kind);
    // Send what was typed, not the parsed values: the server parses with the same schema and recomputes every amount.
    const result = await callAction(() => savePurchaseBillAction(values, kind === "post"));
    setSaving(null);
    setConfirmPost(false);
    if (!result.ok) {
      toast.error(result.error);
      applyFieldErrors(form.setError, result.fieldErrors);
      const target = firstStepWithError(Object.keys(result.fieldErrors ?? {}));
      if (target) goTo(target);
      return;
    }
    props.onSaved(values.vendor_id || null);
    if (kind === "photo") {
      toast.success("Saved. Someone can complete it later.");
      router.push("/app/purchases");
      return;
    }
    if (result.data.postError) toast.error(`Saved as a draft, but it could not be added to stock: ${result.data.postError}`);
    setDone({
      id: result.data.id,
      posted: result.data.posted,
      postError: result.data.postError,
      vendorName: vendor?.name ?? null,
      number: String(values.vendor_invoice_number ?? "").trim(),
      totalPaise: totals.totalPaise,
    });
    window.scrollTo({ top: 0 });
  }

  async function askToPost() {
    if (busy) return;
    if (await readyToSave("post")) setConfirmPost(true);
  }

  if (done) return <SuccessScreen done={done} canPost={canPost} onAddAnother={props.onAddAnother} />;

  const suggestionOverridden = supply.vendorState !== null && supply.isInterState !== !!isInterState;
  const choice = dateChoice(billDate, today);
  const yesterday = addDays(today, -1);
  const linesError = errors.lines?.message ?? errors.lines?.root?.message;
  const saveDraftButton =
    !blank && !photoOnly ? (
      <Button type="button" variant="ghost" className="h-11 shrink-0 px-3 lg:hidden" disabled={busy} onClick={() => void save("draft")}>
        {saving === "draft" ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} Save draft
      </Button>
    ) : null;

  return (
    <>
      <form
        noValidate
        className="pb-[calc(env(safe-area-inset-bottom)+1.5rem)] lg:pb-0"
        onSubmit={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // A barcode scanner (or a stray Enter) in a text box must not submit anything.
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
        }}
      >
        <ProgressDots step={step} completeness={completeness} onPick={goTo} />

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="grid min-w-0 gap-6">
            <StepSection n={2} current={step} action={saveDraftButton}>
              <PhotoStrip paths={attachmentPaths ?? []} urls={urls} className="mb-5 lg:hidden" />
              <div className="grid gap-6">
                <div>
                  <Label htmlFor="vendor-search" className="text-base font-medium">
                    Supplier
                  </Label>
                  <div className="mt-2">
                    <SupplierPicker
                      id="vendor-search"
                      vendors={vendors}
                      recentIds={props.recentVendorIds}
                      value={vendorId}
                      onChange={(id) => chooseVendor(id)}
                      onCreate={props.canCreateVendor ? (name) => setVendorDialog(name) : undefined}
                      error={errors.vendor_id?.message}
                    />
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="vendor_invoice_number" className="text-base font-medium">
                      Bill number
                    </Label>
                    <Input
                      id="vendor_invoice_number"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={50}
                      enterKeyHint="next"
                      placeholder="As printed on the bill"
                      className="tabular mt-2 h-12 text-lg lg:h-10 lg:text-base"
                      aria-invalid={!!errors.vendor_invoice_number || undefined}
                      {...form.register("vendor_invoice_number")}
                    />
                    {errors.vendor_invoice_number?.message ? (
                      <p className="mt-1.5 text-sm text-destructive" role="alert">
                        {errors.vendor_invoice_number.message}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm text-muted-foreground">Look for &quot;Invoice No.&quot; or &quot;Bill No.&quot;</p>
                    )}
                  </div>

                  <fieldset>
                    <legend className="text-base font-medium">Bill date</legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {[
                        { value: today, label: "Today", on: choice === "today" },
                        { value: yesterday, label: "Yesterday", on: choice === "yesterday" },
                      ].map((chip) => (
                        <Button
                          key={chip.label}
                          type="button"
                          variant="outline"
                          aria-pressed={chip.on}
                          className={cn("h-12 flex-col gap-0 text-base lg:h-10 lg:flex-row lg:gap-1.5", chip.on && "border-primary bg-primary/10 text-primary hover:bg-primary/15")}
                          onClick={() => setDate(chip.value)}
                        >
                          {chip.on ? <Check className="hidden lg:block" aria-hidden /> : null}
                          {chip.label}
                          <span className="text-xs font-normal text-muted-foreground lg:text-sm">{formatDate(chip.value).slice(0, 5)}</span>
                        </Button>
                      ))}
                    </div>
                    <Label htmlFor="vendor_invoice_date" className="mt-3 block text-sm text-muted-foreground">
                      Or pick the date
                    </Label>
                    <Input
                      id="vendor_invoice_date"
                      type="date"
                      max={today}
                      className="mt-1 h-12 text-base lg:h-10"
                      aria-invalid={!!errors.vendor_invoice_date || undefined}
                      {...form.register("vendor_invoice_date", { onChange: () => form.clearErrors("vendor_invoice_date") })}
                    />
                    {errors.vendor_invoice_date?.message ? (
                      <p className="mt-1.5 text-sm text-destructive" role="alert">
                        {errors.vendor_invoice_date.message}
                      </p>
                    ) : null}
                  </fieldset>
                </div>

                {outlets.length > 1 ? (
                  <div>
                    <Label htmlFor="outlet_id" className="text-base font-medium">
                      Goods received at
                    </Label>
                    <NativeSelect
                      id="outlet_id"
                      className="mt-2 h-12 text-base lg:h-10"
                      {...form.register("outlet_id", { onChange: (e) => suggestTaxType(String(e.target.value)) })}
                    >
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <p className="mt-1.5 text-sm text-muted-foreground">Stock goes up at this outlet.</p>
                  </div>
                ) : null}

                <div className="rounded-xl border bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <Info className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-medium">GST on this bill: {isInterState ? "IGST" : "CGST + SGST"}</p>
                      <p className="text-sm text-muted-foreground">
                        {supply.vendorState === null
                          ? "Pick what the supplier's bill shows."
                          : supply.isInterState
                            ? `The supplier is in ${stateName(supply.vendorState)} and you are in ${stateName(supply.ourState)}.`
                            : `The supplier and you are both in ${stateName(supply.ourState)}.`}
                        {suggestionOverridden ? " You changed this. Keep it only if the bill shows it." : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 shrink-0 px-3"
                      aria-expanded={taxTypeOpen}
                      aria-controls="tax-type-options"
                      onClick={() => setTaxTypeOpen(!taxTypeOpen)}
                    >
                      Change
                    </Button>
                  </div>
                  <div id="tax-type-options" hidden={!taxTypeOpen} className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                      { inter: false, label: "CGST + SGST", sub: "Supplier in your state" },
                      { inter: true, label: "IGST", sub: "Supplier in another state" },
                    ].map((option) => (
                      <label
                        key={option.label}
                        className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border bg-background px-3 py-2 text-base has-checked:border-primary has-checked:bg-primary/5"
                      >
                        <input
                          type="radio"
                          name="tax_type"
                          className="size-5 accent-[var(--primary)]"
                          checked={!!isInterState === option.inter}
                          onChange={() => form.setValue("is_inter_state", option.inter, { shouldDirty: true })}
                        />
                        <span>
                          {option.label}
                          <span className="block text-sm text-muted-foreground">{option.sub}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </StepSection>

            <StepSection n={3} current={step} action={saveDraftButton}>
              <PhotoStrip paths={attachmentPaths ?? []} urls={urls} className="mb-4 lg:hidden" />
              {lineFields.fields.length > 0 ? (
                <ol className="grid gap-3" aria-label="Items on this bill">
                  {lineFields.fields.map((field, i) => (
                    <ItemCard
                      key={field.id}
                      form={form}
                      index={i}
                      fieldId={field.id}
                      units={units}
                      gstRates={gstRates}
                      result={totals.lines[i] ?? null}
                      lastRatePaise={lines?.[i]?.product_id ? (lastRates[String(lines[i].product_id)] ?? null) : null}
                      onRemove={() => removeLine(i)}
                    />
                  ))}
                </ol>
              ) : (
                <p className="rounded-xl border border-dashed px-4 py-5 text-center text-base text-muted-foreground">
                  No items yet. Tap an item below, or search for it.
                </p>
              )}
              {linesError ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {linesError}
                </p>
              ) : null}
              <div className="mt-6">
                <h3 className="mb-2 text-base font-semibold">{lineCount > 0 ? "Add more items" : "Add items"}</h3>
                <ProductPicker
                  vendorId={vendorId}
                  vendorName={vendor?.name ?? null}
                  outletId={outlet.id}
                  inBill={inBill}
                  onPick={addProduct}
                  onCreate={props.canCreateProduct ? (name) => setProductDialog(name) : undefined}
                  onAddExpense={addExpense}
                />
              </div>
            </StepSection>
          </div>

          <div className="grid min-w-0 gap-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:p-0.5">
            <StepSection n={1} current={step} badge="Optional">
              <AttachmentsField
                businessId={props.businessId}
                paths={attachmentPaths ?? []}
                onChange={(paths) => form.setValue("attachment_paths", paths, { shouldDirty: true })}
                urls={urls}
                onUrls={(added) => setUrls((current) => ({ ...current, ...added }))}
                onBusyChange={setUploading}
              />
              {errors.attachment_paths?.message ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {errors.attachment_paths.message}
                </p>
              ) : null}
              {photoOnly ? (
                <div className="mt-5 rounded-xl border bg-muted/30 p-3">
                  <Button type="button" variant="outline" className="h-12 w-full text-base whitespace-normal lg:h-auto lg:min-h-10" disabled={busy} onClick={() => void save("photo")}>
                    {saving === "photo" ? <Loader2 className="animate-spin" aria-hidden /> : <Clock className="size-5" aria-hidden />}
                    Save photo only, fill details later
                  </Button>
                  <p className="mt-2 text-sm text-muted-foreground">No time now? Save the photo. A manager can fill in the rest.</p>
                </div>
              ) : null}
            </StepSection>

            <StepSection n={4} current={step}>
              <StepCheck
                form={form}
                totals={totals}
                isInterState={!!isInterState}
                paperTotal={paperTotal}
                onPaperTotal={setPaperTotal}
                summary={{
                  vendorName: vendor?.name ?? null,
                  number: billNumber,
                  date: billDate,
                  items: lineCount,
                  outletName: outlets.length > 1 ? outlet.name : null,
                }}
                onJump={goTo}
                canPost={canPost}
                saving={saving}
                disabled={busy}
                onSaveDraft={() => void save("draft")}
                onPost={() => void askToPost()}
              />
            </StepSection>
          </div>
        </div>
      </form>

      {/* Phone bottom bar: it covers the app's bottom navigation while a purchase is being entered. */}
      <div className="no-print fixed inset-x-0 bottom-0 z-[45] border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(0_0_0/0.06)] lg:hidden">
        <div className="mx-auto flex h-[4.5rem] max-w-2xl items-center gap-2 px-3">
          <Button type="button" variant="outline" className="h-12 shrink-0 px-4 text-base" onClick={goBack}>
            {step === 1 ? (
              "Cancel"
            ) : (
              <>
                <ArrowLeft className="size-5" aria-hidden /> Back
              </>
            )}
          </Button>
          {step < 4 ? (
            <>
              <div className="tabular min-w-0 flex-1 text-center leading-tight" aria-live="polite">
                {step === 1 ? (
                  <span className="text-sm text-muted-foreground">
                    {uploading
                      ? "Uploading"
                      : (attachmentPaths ?? []).length === 0
                        ? "No photo yet"
                        : `${attachmentPaths!.length} page${attachmentPaths!.length === 1 ? "" : "s"}`}
                  </span>
                ) : (
                  <>
                    <span className="block truncate text-base font-bold">{formatINR(totals.totalPaise)}</span>
                    <span className="block text-xs text-muted-foreground">{lineCount === 1 ? "1 item" : `${lineCount} items`}</span>
                  </>
                )}
              </div>
              <Button type="button" className="h-12 shrink-0 px-5 text-base" disabled={busy} onClick={() => void next()}>
                Next <ArrowRight className="size-5" aria-hidden />
              </Button>
            </>
          ) : (
            <Button type="button" className="h-12 min-w-0 flex-1 text-base" disabled={busy} onClick={() => (canPost ? void askToPost() : void save("draft"))}>
              {saving === "post" || (!canPost && saving === "draft") ? <Loader2 className="animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
              <span className="min-w-0 truncate">{canPost ? "Save and add to stock" : "Save"}</span>
            </Button>
          )}
        </div>
      </div>

      <Sheet open={confirmPost} onOpenChange={(open) => saving !== "post" && setConfirmPost(open)}>
        <SheetContent side="bottom" showCloseButton={false} className="mx-auto max-w-lg rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="pb-0">
            <SheetTitle className="text-xl">Add to stock?</SheetTitle>
            <SheetDescription className="text-base">Stock will go up for these items and the bill will be locked.</SheetDescription>
          </SheetHeader>
          <p className="tabular px-4 text-base">
            {lineCount === 1 ? "1 item" : `${lineCount} items`} · {formatINR(totals.totalPaise)}
            {outlets.length > 1 ? ` · at ${outlet.name}` : ""}
          </p>
          <SheetFooter>
            <Button type="button" className="h-12 text-base" disabled={saving !== null} onClick={() => void save("post")}>
              {saving === "post" ? <Loader2 className="animate-spin" aria-hidden /> : <Check className="size-5" aria-hidden />}
              Yes, add to stock
            </Button>
            <Button type="button" variant="outline" className="h-12 text-base" disabled={saving === "post"} onClick={() => setConfirmPost(false)}>
              Not now
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Rendered outside the <form> so their own forms are never nested inside it. */}
      <QuickVendorDialog
        initialName={vendorDialog}
        onClose={() => setVendorDialog(null)}
        onCreated={(created) => {
          props.onVendorCreated(created);
          chooseVendor(created.id, [...vendors, created]);
        }}
      />
      <QuickProductDialog initialName={productDialog} units={units} gstRates={gstRates} onClose={() => setProductDialog(null)} onCreated={(p) => void addProduct(p)} />
      {guard.dialog}
    </>
  );
}

function ProgressDots({ step, completeness, onPick }: { step: PurchaseStep; completeness: StepCompleteness; onPick: (step: PurchaseStep) => void }) {
  const done: Record<PurchaseStep, boolean> = { 1: completeness.photo, 2: completeness.supplier, 3: completeness.items, 4: false };
  return (
    <nav aria-label="Steps" className="mb-5 lg:hidden">
      <ol className="grid grid-cols-4">
        {PURCHASE_STEPS.map((s, i) => {
          const current = s.step === step;
          return (
            <li key={s.step} className="relative">
              {i > 0 ? <span className="absolute top-6 right-1/2 h-0.5 w-full -translate-y-1/2 bg-border" aria-hidden /> : null}
              <button
                type="button"
                onClick={() => onPick(s.step)}
                aria-current={current ? "step" : undefined}
                className="relative flex min-h-12 w-full flex-col items-center gap-1 rounded-lg py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full border-2 bg-background text-base font-semibold",
                    current
                      ? "border-primary bg-primary text-primary-foreground"
                      : done[s.step]
                        ? "border-emerald-600 text-emerald-700"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {done[s.step] && !current ? <Check className="size-5" aria-hidden /> : s.step}
                </span>
                <span className={cn("text-sm", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {s.label}
                  {done[s.step] ? <span className="sr-only"> (done)</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** One step. On a phone only the current step shows; on a computer every step shows as a section. */
function StepSection({
  n,
  current,
  badge,
  action,
  children,
}: {
  n: PurchaseStep;
  current: PurchaseStep;
  badge?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { title, hint } = STEP_TITLES[n];
  return (
    <section
      id={`purchase-step-${n}`}
      aria-labelledby={`purchase-step-${n}-title`}
      className={cn(current === n ? "block" : "hidden lg:block", "min-w-0 scroll-mt-20 lg:rounded-xl lg:border lg:p-4")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`purchase-step-${n}-title`} tabIndex={-1} className="text-xl font-semibold outline-none lg:text-base">
            <span className="text-muted-foreground lg:text-foreground">
              <span className="lg:hidden">Step {n} of 4: </span>
              <span className="hidden lg:inline">{n}. </span>
            </span>
            {title}
            {badge ? <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-xs font-medium text-muted-foreground">{badge}</span> : null}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SuccessScreen({ done, canPost, onAddAnother }: { done: Done; canPost: boolean; onAddAnother: () => void }) {
  return (
    <div className="mx-auto max-w-md py-6 text-center" role="status">
      <CheckCircle2 className={cn("mx-auto size-16", done.posted ? "text-emerald-600" : "text-primary")} aria-hidden />
      <h2 className="mt-4 text-2xl font-semibold">{done.posted ? "Saved and added to stock" : "Saved as draft"}</h2>
      <p className="mt-2 text-base text-muted-foreground">
        {done.posted
          ? "Stock is updated and the bill is locked."
          : done.postError
            ? `It could not be added to stock: ${done.postError}`
            : canPost
              ? "Stock has not changed yet. Add it to stock when you are ready."
              : "A manager will check it and add it to stock."}
      </p>
      <div className="tabular mt-5 rounded-xl border p-4 text-left text-base">
        <p className="truncate font-medium">{done.vendorName ?? "Supplier not picked yet"}</p>
        <p className="text-sm text-muted-foreground">{done.number ? `Bill ${done.number}` : "No bill number yet"}</p>
        <p className="mt-2 text-xl font-bold">{formatINR(done.totalPaise)}</p>
      </div>
      <div className="mt-6 grid gap-3">
        <Button type="button" className="h-14 text-base" onClick={onAddAnother}>
          <Plus className="size-5" aria-hidden /> Add another purchase
        </Button>
        <Button variant="outline" className="h-12 text-base" asChild>
          <Link href={`/app/purchases/${done.id}`}>View bill</Link>
        </Button>
        <Button variant="ghost" className="h-12 text-base" asChild>
          <Link href="/app/purchases">Back to purchases</Link>
        </Button>
      </div>
    </div>
  );
}
