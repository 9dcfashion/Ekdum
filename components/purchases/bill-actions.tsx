"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Ban, CheckCircle2, IndianRupee, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, MoneyInput, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelPurchaseBillAction,
  deleteDraftPurchaseAction,
  deletePurchasePaymentAction,
  postPurchaseBillAction,
  recordPurchasePaymentAction,
} from "@/app/app/(shell)/purchases/actions";
import { formatINR, paiseToRupees } from "@/lib/money";
import { useAction } from "@/lib/use-action";
import {
  PURCHASE_PAYMENT_MODES,
  PURCHASE_PAYMENT_MODE_LABELS,
  cancelPurchaseSchema,
  purchasePaymentSchema,
  type CancelPurchaseInput,
  type PurchasePaymentInput,
} from "@/lib/validation/purchases";
import { applyFieldErrors, callAction } from "./form-helpers";

/** Post a draft. Never optimistic: the page refreshes only after the server confirms. */
export function PostBillButton({ billId, outletName }: { billId: string; outletName: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button>
          <CheckCircle2 aria-hidden /> Post
        </Button>
      }
      title="Post this purchase bill?"
      description={`Posting adds the items to stock at ${outletName} and locks the bill. To change it afterwards you would have to cancel it and enter it again.`}
      confirmLabel="Post bill"
      onConfirm={async () => {
        const result = await callAction(() => postPurchaseBillAction({ id: billId }));
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        toast.success("Purchase bill posted. Stock is updated.");
        router.refresh();
      }}
    />
  );
}

export function DeleteDraftButton({ billId }: { billId: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive">
          <Trash2 aria-hidden /> Delete draft
        </Button>
      }
      title="Delete this draft?"
      description="The draft and its attached files are removed for good. Stock is not affected."
      confirmLabel="Delete draft"
      destructive
      onConfirm={async () => {
        const result = await callAction(() => deleteDraftPurchaseAction({ id: billId }));
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        toast.success("Draft deleted");
        router.push("/app/purchases");
      }}
    />
  );
}

/** Cancel a posted bill. A reason is required; the database refuses while payments exist. */
export function CancelBillDialog({ billId, hasPayments }: { billId: string; hasPayments: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const form = useForm<CancelPurchaseInput>({
    resolver: zodResolver(cancelPurchaseSchema),
    defaultValues: { id: billId, reason: "" },
  });
  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Ban aria-hidden /> Cancel bill
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this purchase bill?</DialogTitle>
          <DialogDescription>
            The stock this bill added is taken back out and the bill is marked cancelled. This cannot be undone.
            {hasPayments ? " Remove the recorded payments first: a bill with payments cannot be cancelled." : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit(() =>
            run(() => cancelPurchaseBillAction(form.getValues()), {
              success: "Purchase bill cancelled",
              onSuccess: () => {
                setOpen(false);
                router.refresh();
              },
              onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
            }),
          )}
        >
          <Field label="Reason" htmlFor="cancel-reason" required error={errors.reason?.message} hint="For example: entered twice, goods returned to vendor">
            <Textarea id="cancel-reason" rows={2} maxLength={300} autoFocus {...form.register("reason")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Keep bill
            </Button>
            <SubmitButton pending={pending} variant="destructive">
              Cancel bill
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentDialog({ billId, outstandingPaise, today }: { billId: string; outstandingPaise: number; today: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <IndianRupee aria-hidden /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment to the vendor</DialogTitle>
          <DialogDescription>
            Still to pay: <span className="tabular font-medium text-foreground">{formatINR(outstandingPaise)}</span>
          </DialogDescription>
        </DialogHeader>
        {open ? <PaymentForm billId={billId} outstandingPaise={outstandingPaise} today={today} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({ billId, outstandingPaise, today, onDone }: { billId: string; outstandingPaise: number; today: string; onDone: () => void }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const form = useForm<PurchasePaymentInput>({
    resolver: zodResolver(purchasePaymentSchema),
    defaultValues: { bill_id: billId, amount: paiseToRupees(outstandingPaise), mode: "cash", paid_on: today, reference: "" },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(() =>
        run(() => recordPurchasePaymentAction(form.getValues()), {
          success: "Payment recorded",
          onSuccess: () => {
            onDone();
            router.refresh();
          },
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" htmlFor="pay-amount" required error={errors.amount?.message}>
          <MoneyInput id="pay-amount" autoFocus {...form.register("amount")} />
        </Field>
        <Field label="Paid by" htmlFor="pay-mode" required error={errors.mode?.message}>
          <NativeSelect id="pay-mode" {...form.register("mode")}>
            {PURCHASE_PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {PURCHASE_PAYMENT_MODE_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Paid on" htmlFor="pay-date" required error={errors.paid_on?.message}>
          <Input id="pay-date" type="date" max={today} {...form.register("paid_on")} />
        </Field>
        <Field label="Reference" htmlFor="pay-ref" error={errors.reference?.message} hint="UPI ref, cheque no. or similar">
          <Input id="pay-ref" autoComplete="off" maxLength={100} {...form.register("reference")} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>Record payment</SubmitButton>
      </DialogFooter>
    </form>
  );
}

export function DeletePaymentButton({ paymentId, label }: { paymentId: string; label: string }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`Delete payment of ${label}`}>
          <Trash2 aria-hidden />
        </Button>
      }
      title="Delete this payment?"
      description={`The payment of ${label} is removed and the amount still to pay goes back up.`}
      confirmLabel="Delete payment"
      destructive
      onConfirm={async () => {
        const result = await callAction(() => deletePurchasePaymentAction({ id: paymentId }));
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        toast.success("Payment deleted");
        router.refresh();
      }}
    />
  );
}
