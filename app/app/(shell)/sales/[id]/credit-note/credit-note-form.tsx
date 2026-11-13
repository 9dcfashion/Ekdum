"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Decimal, formatINR, formatQty, roundPaise } from "@/lib/money";
import { useAction } from "@/lib/use-action";
import { creditNoteSchema } from "@/lib/validation/sales";
import { createCreditNoteAction } from "../../actions";
import { MONEY_MODES, PAYMENT_MODE_LABELS } from "../../labels";

export interface ReturnLine {
  id: string;
  lineNo: number;
  description: string;
  unitCode: string;
  allowDecimal: boolean;
  /** Decimal strings. */
  sold: string;
  returned: string;
  remaining: string;
  /** Line total on the bill, tax included. */
  totalPaise: number;
}

const formSchema = z.object({
  items: z.array(z.object({ invoice_item_id: z.string(), quantity: z.string() })),
  reason: creditNoteSchema.shape.reason,
  restock: z.boolean(),
  refund_mode: z.enum(MONEY_MODES),
});
type FormValues = z.input<typeof formSchema>;

/** A typed return quantity checked against its line. Blank or zero means "not returning this line". */
function checkQuantity(text: string, line: ReturnLine): { quantity: Decimal | null; error: string | null } {
  const raw = text.trim();
  if (raw === "") return { quantity: null, error: null };
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) return { quantity: null, error: "Enter a number with up to 3 decimals" };
  const quantity = new Decimal(raw);
  if (quantity.isZero()) return { quantity: null, error: null };
  if (!line.allowDecimal && !quantity.isInteger()) return { quantity: null, error: "Whole units only" };
  if (quantity.greaterThan(line.remaining)) return { quantity: null, error: `Only ${formatQty(line.remaining)} left to return` };
  return { quantity, error: null };
}

export function CreditNoteForm({ invoiceId, amountDuePaise, lines }: { invoiceId: string; amountDuePaise: number; lines: ReturnLine[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      items: lines.map((l) => ({ invoice_item_id: l.id, quantity: "" })),
      reason: "",
      restock: true,
      refund_mode: "cash",
    },
  });
  const { errors } = form.formState;
  const typed = useWatch({ control: form.control, name: "items" });

  // Estimate only: each line in proportion to the quantity returned. The database works out the exact figure.
  const checks = lines.map((line, i) => checkQuantity(typed?.[i]?.quantity ?? "", line));
  const estimate = checks.reduce(
    (sum, c, i) => (c.quantity ? sum + roundPaise(new Decimal(lines[i].totalPaise).times(c.quantity).dividedBy(lines[i].sold)) : sum),
    0,
  );
  const selected = checks.filter((c) => c.quantity).length;
  const adjusted = Math.min(amountDuePaise, estimate);
  const refund = estimate - adjusted;

  function submit(values: FormValues) {
    let invalid = false;
    const items: Array<{ invoice_item_id: string; quantity: string }> = [];
    lines.forEach((line, i) => {
      const result = checkQuantity(values.items[i]?.quantity ?? "", line);
      if (result.error) {
        invalid = true;
        form.setError(`items.${i}.quantity`, { message: result.error });
      } else if (result.quantity) {
        items.push({ invoice_item_id: line.id, quantity: result.quantity.toFixed() });
      }
    });
    if (invalid) return;
    if (items.length === 0) {
      form.setError("root", { message: "Enter the quantity returned for at least one item" });
      return;
    }
    run(
      () => createCreditNoteAction({ invoice_id: invoiceId, items, reason: values.reason, restock: values.restock, refund_mode: values.refund_mode }),
      {
        success: "Credit note issued",
        silentError: true,
        onError: (message) => form.setError("root", { message }),
        onSuccess: (data) => router.push(`/app/sales/credit-notes/${data.id}`),
      },
    );
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-5">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Sold</TableHead>
              <TableHead className="text-right">Already returned</TableHead>
              <TableHead className="w-44 text-right">Returning now</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, i) => {
              const done = line.remaining === "0";
              const fieldError = errors.items?.[i]?.quantity?.message ?? (typed?.[i]?.quantity ? checks[i].error : null);
              return (
                <TableRow key={line.id} className={done ? "text-muted-foreground" : undefined}>
                  <TableCell className="tabular text-muted-foreground">{line.lineNo}</TableCell>
                  <TableCell className="min-w-40">{line.description}</TableCell>
                  <TableCell className="tabular text-right whitespace-nowrap">
                    {formatQty(line.sold)} <span className="text-xs text-muted-foreground">{line.unitCode}</span>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatQty(line.returned)}</TableCell>
                  <TableCell className="text-right">
                    {done ? (
                      <span className="text-xs">Fully returned</span>
                    ) : (
                      <div className="ml-auto grid w-36 gap-1">
                        <input
                          type="text"
                          inputMode={line.allowDecimal ? "decimal" : "numeric"}
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`Quantity of ${line.description} being returned, up to ${formatQty(line.remaining)}`}
                          aria-invalid={fieldError ? true : undefined}
                          className="tabular h-8 w-full rounded-lg border border-input bg-background px-2.5 text-right text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
                          {...form.register(`items.${i}.quantity`)}
                        />
                        {fieldError ? (
                          <p className="text-xs text-destructive" role="alert">
                            {fieldError}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">of {formatQty(line.remaining)} left</p>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.clearErrors();
            lines.forEach((line, i) => form.setValue(`items.${i}.quantity`, line.remaining === "0" ? "" : line.remaining));
          }}
        >
          Return everything that is left
        </Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="grid content-start gap-4">
          <Field label="Reason for the return" htmlFor="cn-reason" required error={errors.reason?.message}>
            <Textarea id="cn-reason" maxLength={300} aria-invalid={errors.reason ? true : undefined} {...form.register("reason")} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" {...form.register("restock")} />
            <span>
              Put the items back into stock
              <span className="block text-xs text-muted-foreground">Untick this for damaged goods that cannot be sold again.</span>
            </span>
          </label>
          <Field label="Refund paid by" htmlFor="cn-refund-mode" hint="Used only for the part that is paid back to the customer." error={errors.refund_mode?.message}>
            <NativeSelect id="cn-refund-mode" {...form.register("refund_mode")}>
              {MONEY_MODES.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_MODE_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <section className="content-start rounded-xl border p-4" aria-label="Credit note preview" aria-live="polite">
          <h2 className="mb-2 text-sm font-medium">Preview</h2>
          <dl className="grid gap-1.5 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Items being returned</dt>
              <dd className="tabular">{selected}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-muted-foreground">Credit note value (about)</dt>
              <dd className="tabular font-semibold">{formatINR(estimate)}</dd>
            </div>
            {amountDuePaise > 0 ? (
              <div className="flex justify-between gap-6">
                <dt className="text-muted-foreground">Set against what the customer owes</dt>
                <dd className="tabular">{formatINR(adjusted)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-6 border-t pt-2">
              <dt className="text-muted-foreground">To pay back to the customer</dt>
              <dd className="tabular font-semibold">{formatINR(refund)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            This is an estimate. The exact amount, with tax and rounding, is worked out when you issue the credit note.
          </p>
        </section>
      </div>

      {errors.root?.message ? (
        <p className="text-sm text-destructive" role="alert">
          {errors.root.message}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Go back
        </Button>
        <SubmitButton size="lg" pending={pending} pendingText="Issuing…">
          Issue credit note
        </SubmitButton>
      </div>
    </form>
  );
}
