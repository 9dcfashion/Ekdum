"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { maxSequenceForPrefix, validateSeriesPrefix } from "@/lib/gst/numbering";
import { sampleNumber, suggestInvoicePrefix } from "@/lib/settings/series";
import { useAction } from "@/lib/use-action";
import { seriesCreateSchema } from "@/lib/validation/settings";
import {
  addSeriesAction,
  changeSeriesPrefixAction,
  raiseSeriesNumberAction,
  setSeriesActiveAction,
} from "@/app/app/(shell)/settings/actions";
import { applyFieldErrors, runConfirm } from "./run-confirm";
import { CheckRow } from "./section";

type CreateValues = z.input<typeof seriesCreateSchema>;

export interface ActiveServerSeries {
  outlet_id: string;
  document_type: "invoice" | "credit_note";
  prefix: string;
}

const TYPE_LABEL = { invoice: "Invoices", credit_note: "Credit notes" } as const;

export function AddSeriesDialog({
  outlets,
  usedPrefixes,
  activeServer,
  fy,
}: {
  outlets: Array<{ id: string; name: string }>;
  usedPrefixes: string[];
  /** Active server series of the current financial year. */
  activeServer: ActiveServerSeries[];
  fy: string;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const defaults: CreateValues = {
    outlet_id: outlets[0]?.id ?? "",
    document_type: "invoice",
    prefix: suggestInvoicePrefix(usedPrefixes),
    start_number: "1",
    replace_current: true,
  };
  const form = useForm<CreateValues>({ resolver: zodResolver(seriesCreateSchema), defaultValues: defaults });
  const { errors } = form.formState;
  const outletId = useWatch({ control: form.control, name: "outlet_id" });
  const type = useWatch({ control: form.control, name: "document_type" });
  const prefix = (useWatch({ control: form.control, name: "prefix" }) ?? "").trim().toUpperCase();
  const start = Number(useWatch({ control: form.control, name: "start_number" })) || 1;
  const current = activeServer.find((s) => s.outlet_id === outletId && s.document_type === type);
  const taken = !validateSeriesPrefix(prefix) && usedPrefixes.includes(prefix);
  const sample = sampleNumber(prefix, fy, Math.max(1, Math.floor(start)));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={outlets.length === 0}>
          <Plus aria-hidden /> Add series
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a number series</DialogTitle>
          <DialogDescription>For example, to start a new prefix at an outlet. It is created for the current financial year.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) =>
            run(() => addSeriesAction(values), {
              success: "Series added",
              onSuccess: () => setOpen(false),
              onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
            }),
          )}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Outlet" htmlFor="series-outlet" required error={errors.outlet_id?.message}>
              <NativeSelect id="series-outlet" {...form.register("outlet_id")}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Used for" htmlFor="series-type" required error={errors.document_type?.message}>
              <NativeSelect id="series-type" {...form.register("document_type")}>
                <option value="invoice">Invoices (bills)</option>
                <option value="credit_note">Credit notes (returns)</option>
              </NativeSelect>
            </Field>
            <Field
              label="Prefix"
              htmlFor="series-prefix"
              required
              error={errors.prefix?.message ?? (taken ? `${prefix} is already used by another series` : undefined)}
              hint="Up to 4 letters or digits. Never used before in this business."
            >
              <Input id="series-prefix" maxLength={4} className="max-w-28 uppercase tabular" {...form.register("prefix")} />
            </Field>
            <Field
              label="Start numbering from"
              htmlFor="series-start"
              error={errors.start_number?.message}
              hint="Keep 1 unless you are continuing from other software."
            >
              <Input id="series-start" type="number" min={1} inputMode="numeric" className="max-w-28 tabular" {...form.register("start_number")} />
            </Field>
          </div>
          <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            First number: <span className="tabular font-semibold">{sample ?? "—"}</span>
            {!sample && !validateSeriesPrefix(prefix) ? (
              <span className="block text-xs text-destructive">This would be longer than 16 characters. Use a shorter prefix or a smaller number.</span>
            ) : null}
          </p>
          {current ? (
            <CheckRow
              title={`Switch off the current series (${current.prefix}) for this outlet`}
              hint={`An outlet can have only one active series for ${TYPE_LABEL[type].toLowerCase()} at a time. Numbers already issued under ${current.prefix} stay valid.`}
              {...form.register("replace_current")}
            />
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending}>Add series</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface SeriesForActions {
  id: string;
  prefix: string;
  financial_year: string;
  next_number: number;
  is_active: boolean;
  document_type: "invoice" | "credit_note";
  outletName: string;
}

function EditSeriesDialog({ series, usedPrefixes }: { series: SeriesForActions; usedPrefixes: string[] }) {
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState(series.prefix);
  const [nextNumber, setNextNumber] = useState(String(series.next_number));
  const [error, setError] = useState<{ prefix?: string; next_number?: string }>({});
  const prefixAction = useAction();
  const numberAction = useAction();
  const unused = series.next_number === 1;
  const cleanPrefix = prefix.trim().toUpperCase();
  const prefixProblem =
    validateSeriesPrefix(cleanPrefix) ??
    (cleanPrefix !== series.prefix && usedPrefixes.includes(cleanPrefix) ? `${cleanPrefix} is already used by another series` : null);
  const wanted = Number(nextNumber);
  const numberProblem = !/^\d+$/.test(nextNumber.trim())
    ? "Enter a whole number"
    : wanted <= series.next_number
      ? `Must be more than ${series.next_number}. Numbers can only go up.`
      : sampleNumber(series.prefix, series.financial_year, wanted)
        ? null
        : `Too large. With the prefix ${series.prefix} the highest number is ${maxSequenceForPrefix(series.prefix)}.`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPrefix(series.prefix);
          setNextNumber(String(series.next_number));
          setError({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit series <span className="tabular">{series.prefix}</span>
          </DialogTitle>
          <DialogDescription>
            {series.outletName} · {TYPE_LABEL[series.document_type]}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (prefixProblem) return setError({ prefix: prefixProblem });
            prefixAction.run(() => changeSeriesPrefixAction({ id: series.id, prefix: cleanPrefix }), {
              success: "Prefix changed",
              onSuccess: () => setOpen(false),
              onError: (message, fieldErrors) => setError({ prefix: fieldErrors?.prefix?.[0] ?? message }),
              silentError: true,
            });
          }}
        >
          <Field
            label="Prefix"
            htmlFor={`prefix-${series.id}`}
            error={error.prefix}
            hint={
              unused
                ? "No number has been issued yet, so the prefix can still change."
                : "This series has already issued numbers, so its prefix is fixed. Add a new series to use a different prefix."
            }
          >
            <div className="flex gap-2">
              <Input
                id={`prefix-${series.id}`}
                maxLength={4}
                disabled={!unused}
                className="max-w-28 uppercase tabular"
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value);
                  setError({});
                }}
              />
              {unused ? (
                <SubmitButton variant="outline" pending={prefixAction.pending} disabled={prefixAction.pending || cleanPrefix === series.prefix}>
                  Change prefix
                </SubmitButton>
              ) : null}
            </div>
          </Field>
        </form>

        <form
          className="grid gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (numberProblem) return setError({ next_number: numberProblem });
            numberAction.run(() => raiseSeriesNumberAction({ id: series.id, next_number: nextNumber.trim() }), {
              success: "Next number raised",
              onSuccess: () => setOpen(false),
              onError: (message, fieldErrors) => setError({ next_number: fieldErrors?.next_number?.[0] ?? message }),
              silentError: true,
            });
          }}
        >
          <Field
            label="Next number"
            htmlFor={`next-${series.id}`}
            error={error.next_number}
            hint="You can skip ahead (for example, to continue from another system) but never go back. Skipped numbers are never used."
          >
            <div className="flex gap-2">
              <Input
                id={`next-${series.id}`}
                type="number"
                min={series.next_number + 1}
                inputMode="numeric"
                className="max-w-36 tabular"
                value={nextNumber}
                onChange={(e) => {
                  setNextNumber(e.target.value);
                  setError({});
                }}
              />
              <SubmitButton variant="outline" pending={numberAction.pending} disabled={numberAction.pending || wanted === series.next_number}>
                Raise number
              </SubmitButton>
            </div>
          </Field>
          <p className="text-xs text-muted-foreground">
            Next bill:{" "}
            <span className="tabular font-medium text-foreground">
              {(!numberProblem && sampleNumber(series.prefix, series.financial_year, wanted)) ||
                sampleNumber(series.prefix, series.financial_year, series.next_number) ||
                "—"}
            </span>
          </p>
        </form>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

export function SeriesActions({
  series,
  usedPrefixes,
  isCurrentYear,
}: {
  series: SeriesForActions;
  usedPrefixes: string[];
  isCurrentYear: boolean;
}) {
  const kind = TYPE_LABEL[series.document_type].toLowerCase();
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {series.is_active ? <EditSeriesDialog series={series} usedPrefixes={usedPrefixes} /> : null}
      {series.is_active ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
              Switch off
            </Button>
          }
          title={`Switch off the series ${series.prefix}?`}
          description={
            isCurrentYear
              ? `${series.outletName} will not be able to issue ${kind} until another series is active for it. Numbers already issued stay valid. You can switch this series back on later.`
              : "Numbers already issued stay valid. You can switch it back on later."
          }
          confirmLabel="Switch off"
          destructive
          onConfirm={() => runConfirm(() => setSeriesActiveAction({ id: series.id, is_active: false }), "Series switched off")}
        />
      ) : (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              Switch on
            </Button>
          }
          title={`Switch the series ${series.prefix} back on?`}
          description={`It continues from ${series.next_number}. If ${series.outletName} already has an active series for ${kind} this year, switch that one off first.`}
          confirmLabel="Switch on"
          onConfirm={() => runConfirm(() => setSeriesActiveAction({ id: series.id, is_active: true }), "Series switched on")}
        />
      )}
    </div>
  );
}
