"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Copy, FileText, Loader2, Mail, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DOCUMENT_TITLES } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import type { PostedBill, PosServices, PosSettings } from "@/lib/pos/types";
import { Kbd } from "./shortcut-legend";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SuccessBody({
  bill,
  settings,
  sendEmailReceipt,
  printQueuedBill,
  onNewBill,
}: {
  bill: PostedBill;
  settings: PosSettings;
  sendEmailReceipt: PosServices["sendEmailReceipt"];
  printQueuedBill?: PosServices["printQueuedBill"];
  onNewBill: () => void;
}) {
  const [email, setEmail] = useState(bill.customerEmail);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent">(bill.emailQueued ? "sent" : "idle");
  const online = !bill.queued;

  function print() {
    // A bill that only exists on this device is printed from local data: the server has nothing to show yet.
    if (bill.queued) return void printQueuedBill?.(bill.invoiceId);
    window.open(`/app/sales/${bill.invoiceId}/print?format=${settings.defaultPrintFormat}`, "_blank", "noopener,width=480,height=720");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/i/${bill.publicToken}`);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link on this device");
    }
  }

  async function sendEmail() {
    if (!EMAIL_PATTERN.test(email.trim())) return void toast.error("Enter a valid email address");
    setEmailState("sending");
    const result = await sendEmailReceipt(bill.invoiceId, email.trim());
    if (result.ok) {
      setEmailState("sent");
      toast.success("The bill is on its way by email");
    } else {
      setEmailState("idle");
      toast.error(result.error);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col items-center gap-1 text-center">
        {bill.queued ? (
          <span className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <CloudOff className="size-6" aria-hidden />
          </span>
        ) : (
          <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
        )}
        <p className="tabular text-lg font-semibold">{bill.invoiceNumber}</p>
        <p className="tabular text-3xl leading-tight font-semibold tracking-tight">{formatINR(bill.totalPaise)}</p>
        {bill.changePaise > 0 ? (
          <p className="tabular text-sm">
            Change to give back: <span className="font-semibold">{formatINR(bill.changePaise)}</span>
          </p>
        ) : null}
      </div>

      {bill.queued ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900" role="status">
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">Saved offline, will sync.</span> This bill is on this device only. It is sent to the server on its own when the
            connection is back. Print it now and carry on.
          </span>
        </p>
      ) : null}

      {bill.duplicate || bill.warnings.length > 0 ? (
        <ul className="grid gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-900" role="alert">
          {bill.duplicate ? (
            <li className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              This bill had already been saved by an earlier try. Open it in Sales and check it before handing it over.
            </li>
          ) : null}
          {bill.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" className="h-11" onClick={print}>
          <Printer aria-hidden /> Print
        </Button>
        {online ? (
          <>
            <Button variant="outline" className="h-11" asChild>
              <a href={`/api/invoices/${bill.invoiceId}/pdf`} target="_blank" rel="noopener">
                <FileText aria-hidden /> A4 PDF
              </a>
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={() => void copyLink()}>
              <Copy aria-hidden /> Copy link
            </Button>
          </>
        ) : null}
      </div>

      {(bill.emailQueued || bill.whatsappQueued) && online ? (
        <p className="text-center text-sm text-muted-foreground">
          The bill is being sent {[bill.whatsappQueued ? "on WhatsApp" : null, bill.emailQueued ? "by email" : null].filter(Boolean).join(" and ")}.
        </p>
      ) : null}

      {online && settings.emailReceiptsEnabled && !bill.emailQueued ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void sendEmail();
          }}
        >
          <Input
            type="email"
            inputMode="email"
            aria-label="Email the bill to"
            placeholder="Email the bill to…"
            value={email}
            disabled={emailState !== "idle"}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 min-w-0 flex-1"
          />
          <Button type="submit" variant="outline" className="h-9" disabled={emailState !== "idle" || !email.trim()}>
            {emailState === "sending" ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
            {emailState === "sent" ? "Sent" : "Send email"}
          </Button>
        </form>
      ) : null}

      <Button type="button" size="lg" autoFocus className="h-12 text-base" onClick={onNewBill}>
        New bill <Kbd>Enter</Kbd>
      </Button>
    </div>
  );
}

/** Shown after a bill is saved: number, total, print and send options, then on to the next customer. */
export function SuccessDialog({
  bill,
  settings,
  sendEmailReceipt,
  printQueuedBill,
  onNewBill,
  onClosed,
}: {
  bill: PostedBill | null;
  settings: PosSettings;
  sendEmailReceipt: PosServices["sendEmailReceipt"];
  printQueuedBill?: PosServices["printQueuedBill"];
  onNewBill: () => void;
  /** After the dialog has closed, e.g. to put focus back in the search box. */
  onClosed: () => void;
}) {
  return (
    <Dialog open={bill !== null} onOpenChange={(open) => !open && onNewBill()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{bill?.queued ? "Saved offline, will sync" : "Bill saved"}</DialogTitle>
          <DialogDescription>
            {bill ? `${DOCUMENT_TITLES[bill.documentType]}${bill.queued ? ". Not on the server yet." : ""}` : ""}
          </DialogDescription>
        </DialogHeader>
        {bill ? <SuccessBody key={bill.invoiceId} bill={bill} settings={settings} sendEmailReceipt={sendEmailReceipt} printQueuedBill={printQueuedBill} onNewBill={onNewBill} /> : null}
      </DialogContent>
    </Dialog>
  );
}
