"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Ban, Copy, FileText, IndianRupee, Link2, Link2Off, Printer, Truck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatINR, paiseToRupees } from "@/lib/money";
import type { PrintFormat } from "@/lib/types/db";
import { useAction } from "@/lib/use-action";
import { rupeesRequired } from "@/lib/validation/common";
import { cancelInvoiceSchema } from "@/lib/validation/sales";
import { cancelInvoiceAction, recordCollectionAction, setPublicLinkAction } from "../actions";
import { MONEY_MODES, PAYMENT_MODE_LABELS } from "../labels";

export interface InvoiceActionsProps {
  invoiceId: string;
  invoiceNumber: string;
  cancelled: boolean;
  amountDuePaise: number;
  publicToken: string;
  publicLinkOff: boolean;
  printFormat: PrintFormat;
  can: {
    recordPayment: boolean;
    cancel: boolean;
    creditNote: boolean;
    shipment: boolean;
    managePublicLink: boolean;
  };
  /** Plain-language cancel rule from the business settings. */
  cancelRule: string;
  /** Set when the bill can no longer be cancelled (too old, or it has a credit note). */
  cancelBlocked: string | null;
}

const collectionFormSchema = z.object({
  mode: z.enum(MONEY_MODES),
  amount: rupeesRequired("Amount").refine((paise) => paise > 0, "Amount must be more than zero"),
  reference: z.string().trim().max(100, "Too long").optional(),
});
type CollectionForm = z.input<typeof collectionFormSchema>;

function RecordPayment({ invoiceId, amountDuePaise }: { invoiceId: string; amountDuePaise: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const form = useForm<CollectionForm, unknown, z.output<typeof collectionFormSchema>>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { mode: "cash", amount: paiseToRupees(amountDuePaise), reference: "" },
  });
  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) form.reset({ mode: "cash", amount: paiseToRupees(amountDuePaise), reference: "" });
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <IndianRupee aria-hidden /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>{formatINR(amountDuePaise)} is still due on this bill.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) => {
            if (values.amount > amountDuePaise) {
              form.setError("amount", { message: `Only ${formatINR(amountDuePaise)} is due on this bill` });
              return;
            }
            run(() => recordCollectionAction({ invoice_id: invoiceId, mode: values.mode, amount_paise: values.amount, reference: values.reference }), {
              success: "Payment recorded",
              onSuccess: () => {
                setOpen(false);
                router.refresh();
              },
            });
          })}
        >
          <Field label="Amount received" htmlFor="collect-amount" required error={errors.amount?.message}>
            <MoneyInput id="collect-amount" autoFocus aria-invalid={errors.amount ? true : undefined} {...form.register("amount")} />
          </Field>
          <Field label="Paid by" htmlFor="collect-mode" required error={errors.mode?.message}>
            <NativeSelect id="collect-mode" {...form.register("mode")}>
              {MONEY_MODES.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_MODE_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Reference" htmlFor="collect-reference" error={errors.reference?.message} hint="UPI or transfer reference, if any">
            <Input id="collect-reference" maxLength={100} {...form.register("reference")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Close
            </Button>
            <SubmitButton pending={pending} pendingText="Saving…">
              Save payment
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const cancelFormSchema = cancelInvoiceSchema.pick({ reason: true });
type CancelForm = z.input<typeof cancelFormSchema>;

function CancelBill({ invoiceId, invoiceNumber, rule, blocked }: { invoiceId: string; invoiceNumber: string; rule: string; blocked: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const form = useForm<CancelForm>({ resolver: zodResolver(cancelFormSchema), defaultValues: { reason: "" } });
  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Ban aria-hidden /> Cancel bill
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel bill {invoiceNumber}?</DialogTitle>
          <DialogDescription>
            The stock goes back and the bill is marked as cancelled. Its number is kept and never used again. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">{rule}</p>
        {blocked ? (
          <>
            <p className="text-sm text-destructive" role="alert">
              {blocked}
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) =>
              run(() => cancelInvoiceAction({ invoice_id: invoiceId, reason: values.reason }), {
                success: "Bill cancelled",
                silentError: true,
                // Show the database's own message (for example the cancel window) next to the field.
                onError: (message) => form.setError("reason", { message }),
                onSuccess: () => {
                  setOpen(false);
                  router.refresh();
                },
              }),
            )}
          >
            <Field label="Reason for cancelling" htmlFor="cancel-reason" required error={errors.reason?.message}>
              <Textarea id="cancel-reason" autoFocus maxLength={300} aria-invalid={errors.reason ? true : undefined} {...form.register("reason")} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Keep the bill
              </Button>
              <SubmitButton variant="destructive" pending={pending} pendingText="Cancelling…">
                Cancel bill
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceActions(props: InvoiceActionsProps) {
  const router = useRouter();
  const { run } = useAction();
  const { invoiceId, cancelled, can } = props;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/i/${props.publicToken}`);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link on this device");
    }
  }

  function setLink(enabled: boolean) {
    return new Promise<boolean>((resolve) =>
      run(() => setPublicLinkAction({ invoice_id: invoiceId, enabled }), {
        success: enabled ? "Public link is on again" : "Public link switched off",
        onSuccess: () => {
          router.refresh();
          resolve(true);
        },
        onError: () => resolve(false),
      }),
    );
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      {!cancelled && can.recordPayment && props.amountDuePaise > 0 ? (
        <RecordPayment invoiceId={invoiceId} amountDuePaise={props.amountDuePaise} />
      ) : null}
      <Button variant="outline" asChild>
        <a href={`/app/sales/${invoiceId}/print?format=${props.printFormat}`} target="_blank" rel="noopener">
          <Printer aria-hidden /> Print
        </a>
      </Button>
      <Button variant="outline" asChild>
        <a href={`/api/invoices/${invoiceId}/pdf`} target="_blank" rel="noopener">
          <FileText aria-hidden /> PDF
        </a>
      </Button>
      {props.publicLinkOff ? (
        can.managePublicLink ? (
          <Button variant="outline" onClick={() => void setLink(true)}>
            <Link2 aria-hidden /> Turn public link on
          </Button>
        ) : null
      ) : (
        <>
          <Button variant="outline" onClick={() => void copyLink()}>
            <Copy aria-hidden /> Copy public link
          </Button>
          {can.managePublicLink ? (
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <Link2Off aria-hidden /> Turn public link off
                </Button>
              }
              title="Turn off the public link?"
              description="Anyone who has the link, including the customer, will no longer be able to open this bill online. You can turn it back on later."
              confirmLabel="Turn off"
              destructive
              onConfirm={() => setLink(false)}
            />
          ) : null}
        </>
      )}
      {!cancelled && can.shipment ? (
        <Button variant="outline" asChild>
          <Link href={`/app/shipments/new?invoice=${invoiceId}`}>
            <Truck aria-hidden /> Create shipment
          </Link>
        </Button>
      ) : null}
      {!cancelled && can.creditNote ? (
        <Button variant="outline" asChild>
          <Link href={`/app/sales/${invoiceId}/credit-note`}>
            <Undo2 aria-hidden /> Issue credit note
          </Link>
        </Button>
      ) : null}
      {!cancelled && can.cancel ? (
        <CancelBill invoiceId={invoiceId} invoiceNumber={props.invoiceNumber} rule={props.cancelRule} blocked={props.cancelBlocked} />
      ) : null}
    </div>
  );
}
