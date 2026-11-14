"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, Pencil } from "lucide-react";
import { useFormState, useWatch, type UseFormReturn } from "react-hook-form";
import { MoneyInput } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/money";
import type { LiveTotals } from "@/lib/purchases/compute";
import { checkPaperTotal, paperTotalHint, type PurchaseStep } from "@/lib/purchases/flow";
import { cn } from "@/lib/utils";
import { MAX_ROUND_OFF_PAISE, type PurchaseBillData, type PurchaseBillInput } from "@/lib/validation/purchases";

type BillForm = UseFormReturn<PurchaseBillInput, unknown, PurchaseBillData>;

const signed = (paise: number) => `${paise < 0 ? "-" : "+"}${formatINR(Math.abs(paise))}`;

function Row({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <>
      <dt className={strong ? "text-base font-semibold" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("text-right", strong && "text-2xl font-bold")}>{value}</dd>
    </>
  );
}

/**
 * Step 4: the totals, a check against the total printed on the paper bill
 * (with a one-tap round-off), a note, and the save buttons.
 */
export function StepCheck({
  form,
  totals,
  isInterState,
  paperTotal,
  onPaperTotal,
  summary,
  onJump,
  canPost,
  saving,
  disabled,
  onSaveDraft,
  onPost,
}: {
  form: BillForm;
  totals: LiveTotals;
  isInterState: boolean;
  paperTotal: string;
  onPaperTotal: (value: string) => void;
  summary: { vendorName: string | null; number: string; date: string; items: number; outletName: string | null };
  onJump: (step: PurchaseStep) => void;
  canPost: boolean;
  saving: "photo" | "draft" | "post" | null;
  disabled: boolean;
  onSaveDraft: () => void;
  onPost: () => void;
}) {
  const [roundOffOpen, setRoundOffOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const lines = useWatch({ control: form.control, name: "lines" }) ?? [];
  const notes = useWatch({ control: form.control, name: "notes" });
  // Subscribe here: the parent passes the same `form` object every render, so it would not re-render this step on errors.
  const { errors } = useFormState({ control: form.control, name: ["round_off", "notes"] });
  const roundOffError = errors.round_off?.message;
  const notesError = errors.notes?.message;

  const check = checkPaperTotal({ paperTotal, beforeRoundOffPaise: totals.beforeRoundOffPaise, roundOffPaise: totals.roundOffPaise });
  const paperPaise = rupeesToPaise(paperTotal);
  const hint = (check.kind === "big" || check.kind === "small") && paperPaise !== null ? paperTotalHint(lines, isInterState, paperPaise) : null;
  const gstPaise = totals.cgstPaise + totals.sgstPaise + totals.igstPaise;

  function setRoundOff(paise: number) {
    form.setValue("round_off", paise === 0 ? "" : paiseToRupees(paise), { shouldDirty: true, shouldValidate: true });
  }

  function setIncludesTax(includes: boolean) {
    lines.forEach((_, i) => form.setValue(`lines.${i}.price_includes_tax`, includes, { shouldDirty: true }));
  }

  return (
    <div className="grid gap-5">
      {/* On a phone the other steps are hidden, so repeat the key facts with a way back to each. */}
      <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-xl border p-3 text-base lg:hidden">
        <dt className="min-w-0">
          <span className="block text-sm text-muted-foreground">Supplier</span>
          <span className={cn("block truncate font-medium", !summary.vendorName && "text-amber-700")}>{summary.vendorName ?? "Not picked yet"}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {[summary.number ? `Bill ${summary.number}` : "No bill number", summary.date ? formatDate(summary.date) : "No date"].join(" · ")}
          </span>
        </dt>
        <dd>
          <Button type="button" variant="ghost" className="h-11" onClick={() => onJump(2)}>
            <Pencil aria-hidden /> Change
          </Button>
        </dd>
        <dt className="min-w-0 border-t pt-2">
          <span className="block text-sm text-muted-foreground">Items</span>
          <span className="block font-medium">
            {summary.items === 1 ? "1 item" : `${summary.items} items`}
            {summary.outletName ? <span className="font-normal text-muted-foreground"> · at {summary.outletName}</span> : null}
          </span>
        </dt>
        <dd className="border-t pt-2">
          <Button type="button" variant="ghost" className="h-11" onClick={() => onJump(3)}>
            <Pencil aria-hidden /> Change
          </Button>
        </dd>
      </dl>

      <dl className="tabular grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-base">
        <Row label="Items before GST" value={formatINR(totals.taxablePaise)} />
        {isInterState ? (
          <Row label="IGST" value={formatINR(totals.igstPaise)} />
        ) : (
          <Row
            label={
              <>
                GST <span className="text-sm">(CGST {formatINR(totals.cgstPaise)} + SGST {formatINR(totals.sgstPaise)})</span>
              </>
            }
            value={formatINR(gstPaise)}
          />
        )}
        {totals.cessPaise > 0 ? <Row label="Cess" value={formatINR(totals.cessPaise)} /> : null}
        {totals.roundOffPaise !== 0 ? <Row label="Round-off" value={signed(totals.roundOffPaise)} /> : null}
        <div className="col-span-2 border-t" aria-hidden />
        <Row label="Total" value={formatINR(totals.totalPaise)} strong />
      </dl>
      {totals.incompleteLines > 0 ? (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {totals.incompleteLines === 1 ? "1 item is" : `${totals.incompleteLines} items are`} not complete and not in this total.
        </p>
      ) : null}

      <div>
        <Label htmlFor="paper_total" className="text-base font-medium">
          Total on the paper bill
        </Label>
        <p className="mb-2 text-sm text-muted-foreground">Type the final amount printed on the bill. We will check it for you.</p>
        <MoneyInput
          id="paper_total"
          value={paperTotal}
          onChange={(e) => onPaperTotal(e.target.value)}
          placeholder="0.00"
          enterKeyHint="done"
          className="h-12 text-lg font-semibold lg:h-10"
          aria-describedby="paper_total_check"
        />
        <div id="paper_total_check" aria-live="polite" className="mt-2">
          {check.kind === "match" ? (
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-base font-medium text-emerald-800">
              <CheckCircle2 className="size-5 shrink-0" aria-hidden /> Matches the paper bill
            </p>
          ) : check.kind === "invalid" ? (
            <p className="text-sm text-destructive">Type an amount like 1234.50</p>
          ) : check.kind === "round_off" ? (
            <div className="rounded-lg bg-sky-50 p-3 text-sky-900">
              <p className="text-base">Only {formatINR(Math.abs(check.differencePaise))} apart. That is rounding.</p>
              <Button type="button" className="mt-2 h-12 w-full text-base lg:h-10" onClick={() => setRoundOff(check.roundOffPaise)}>
                {check.roundOffPaise === 0 ? "Match (remove round-off)" : `Match (round off ${signed(check.roundOffPaise)})`}
              </Button>
            </div>
          ) : check.kind === "small" || check.kind === "big" ? (
            <div className="rounded-lg bg-amber-50 p-3 text-amber-950">
              <p className="flex items-start gap-2 text-base font-medium">
                <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  The paper says {formatINR(paperPaise)}, the items add up to {formatINR(totals.totalPaise)}. The paper is{" "}
                  {formatINR(Math.abs(check.differencePaise))} {check.differencePaise > 0 ? "more" : "less"}.
                </span>
              </p>
              {hint ? (
                <div className="mt-2 rounded-md bg-background/70 p-2.5">
                  <p className="text-sm">
                    {hint === "rates_include_gst"
                      ? "It matches if the rates on the paper already include GST."
                      : "It matches if the rates on the paper do not include GST."}
                  </p>
                  <Button type="button" variant="outline" className="mt-2 h-12 w-full text-base lg:h-10" onClick={() => setIncludesTax(hint === "rates_include_gst")}>
                    {hint === "rates_include_gst" ? "Yes, rates include GST" : "Rates are before GST"}
                  </Button>
                </div>
              ) : null}
              {check.kind === "small" ? (
                <p className="mt-2 text-sm">
                  Round-off can fix up to {formatINR(MAX_ROUND_OFF_PAISE)} only. Check the GST % and the rates once. If they are right, you can still save; the
                  bill will be saved as {formatINR(totals.totalPaise)}.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-sm font-medium">Please check:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    <li>A quantity or rate typed wrong</li>
                    <li>Rates with GST or without GST (open More on an item)</li>
                    <li>The GST % of each item</li>
                    <li>A missing item, or freight and other charges</li>
                    <li>A discount printed on the paper</li>
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-11 justify-start px-2 text-muted-foreground"
          aria-expanded={roundOffOpen || !!roundOffError}
          aria-controls="round-off-panel"
          onClick={() => setRoundOffOpen(!roundOffOpen)}
        >
          <ChevronDown className={cn("size-4 transition-transform", (roundOffOpen || roundOffError) && "rotate-180")} aria-hidden />
          Change round-off by hand
        </Button>
        <div id="round-off-panel" hidden={!(roundOffOpen || roundOffError)} className="px-2">
          <Label htmlFor="round_off" className="text-sm">
            Round-off (use a minus sign to round down)
          </Label>
          <div className="mt-1">
            <MoneyInput id="round_off" placeholder="0.00" className="h-12 text-base lg:h-10" aria-invalid={!!roundOffError || undefined} {...form.register("round_off")} />
          </div>
          {roundOffError ? (
            <p className="mt-1 text-sm text-destructive" role="alert">
              {roundOffError}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="ghost"
          className="h-11 justify-start px-2 text-muted-foreground"
          aria-expanded={noteOpen || !!notes}
          aria-controls="note-panel"
          onClick={() => setNoteOpen(!noteOpen)}
        >
          <ChevronDown className={cn("size-4 transition-transform", (noteOpen || notes) && "rotate-180")} aria-hidden />
          {notes ? "Note" : "Add a note"}
        </Button>
        <div id="note-panel" hidden={!(noteOpen || notes)} className="px-2">
          <Label htmlFor="notes" className="sr-only">
            Note
          </Label>
          <Textarea id="notes" rows={3} maxLength={1000} placeholder="Only for your own records" className="text-base" {...form.register("notes")} />
          {notesError ? <p className="mt-1 text-sm text-destructive">{notesError}</p> : null}
        </div>
      </div>

      <div className="grid gap-2">
        {/* On a phone the main save button sits in the bottom bar; on a computer it is here. */}
        <Button type="button" className="hidden h-11 text-base lg:inline-flex" disabled={disabled} onClick={canPost ? onPost : onSaveDraft}>
          {saving === (canPost ? "post" : "draft") ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {canPost ? "Save and add to stock" : "Save"}
        </Button>
        {canPost ? (
          <Button type="button" variant="outline" className="h-12 text-base lg:h-10" disabled={disabled} onClick={onSaveDraft}>
            {saving === "draft" ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save as draft
          </Button>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {canPost
            ? "A draft does not change stock. You can add it to stock later."
            : "It is saved as a draft. A manager checks it and adds it to stock."}
        </p>
      </div>
    </div>
  );
}
