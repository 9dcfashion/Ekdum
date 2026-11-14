"use client";

import { useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, CloudOff, Copy, FileText, Loader2, Mail, MessageCircle, Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DOCUMENT_TITLES, formatMobile, isValidMobile } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { billLink, billShareText, whatsappUrl } from "@/lib/pos/share";
import type { PostedBill, PosServices, PosSettings } from "@/lib/pos/types";
import { SalePhotoUploader } from "@/components/sales/sale-photo-uploader";
import { Kbd } from "./shortcut-legend";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SuccessBody({
  bill,
  settings,
  sendEmailReceipt,
  printQueuedBill,
  onNewBill,
  photoBusy,
  onPhotoBusy,
}: {
  bill: PostedBill;
  settings: PosSettings;
  sendEmailReceipt: PosServices["sendEmailReceipt"];
  printQueuedBill?: PosServices["printQueuedBill"];
  onNewBill: () => void;
  photoBusy: boolean;
  onPhotoBusy: (busy: boolean) => void;
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

      <section className="grid gap-2 rounded-lg border p-3" aria-label="Photo of items given">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Camera className="size-4 text-muted-foreground" aria-hidden /> Photo of items given <span className="font-normal text-muted-foreground">(optional)</span>
        </p>
        {online ? (
          <SalePhotoUploader businessId={settings.businessId} invoiceId={bill.invoiceId} onBusyChange={onPhotoBusy} />
        ) : (
          <p className="text-xs text-muted-foreground">This bill is saved on this device only. Add photos from the bill in Sales once it has synced.</p>
        )}
      </section>

      <Button type="button" size="lg" autoFocus className="h-12 text-base" onClick={onNewBill} disabled={photoBusy}>
        {photoBusy ? (
          <>
            <Loader2 className="animate-spin" aria-hidden /> Saving photo…
          </>
        ) : (
          <>
            New bill <Kbd>Enter</Kbd>
          </>
        )}
      </Button>
    </div>
  );
}

function openPrint(bill: PostedBill, settings: PosSettings, printQueuedBill?: PosServices["printQueuedBill"]) {
  // A bill that only exists on this device is printed from local data: the server has nothing to show yet.
  if (bill.queued) return void printQueuedBill?.(bill.invoiceId);
  window.open(`/app/sales/${bill.invoiceId}/print?format=${settings.defaultPrintFormat}`, "_blank", "noopener,width=480,height=720");
}

/** The phone version: big Print, Send on WhatsApp, Share, then New bill. */
function MobileSuccessBody({
  bill,
  settings,
  sendEmailReceipt,
  printQueuedBill,
  onNewBill,
  photoBusy,
  onPhotoBusy,
}: {
  bill: PostedBill;
  settings: PosSettings;
  sendEmailReceipt: PosServices["sendEmailReceipt"];
  printQueuedBill?: PosServices["printQueuedBill"];
  onNewBill: () => void;
  photoBusy: boolean;
  onPhotoBusy: (busy: boolean) => void;
}) {
  const online = !bill.queued;
  const knownPhone = isValidMobile(bill.customerPhone) ? bill.customerPhone : "";
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(bill.customerEmail);
  const [emailState, setEmailState] = useState<"idle" | "sending" | "sent">(bill.emailQueued ? "sent" : "idle");
  const sendTo = knownPhone || (isValidMobile(phone) ? phone : "");
  // This panel only ever renders in the browser (a bill exists only after posting there).
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = billLink(origin, bill.publicToken);
  const message = billShareText({ businessName: settings.businessName, invoiceNumber: bill.invoiceNumber, totalPaise: bill.totalPaise, link });

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        // The link is already in the text; passing it twice makes some apps show it twice.
        await navigator.share({ title: `Bill ${bill.invoiceNumber}`, text: message });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return; // the cashier closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied. Paste it in any app to send the bill.");
    } catch {
      toast.error("Could not share or copy the link on this phone");
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-4 pt-6 pb-6">
        <div className="flex flex-col items-center gap-1 text-center">
          {bill.queued ? (
            <span className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <CloudOff className="size-8" aria-hidden />
            </span>
          ) : (
            <CheckCircle2 className="size-14 text-emerald-600" aria-hidden />
          )}
          <p className="text-xl font-semibold">{bill.queued ? "Saved on this phone" : "Bill saved"}</p>
          <p className="tabular text-base text-muted-foreground">{bill.invoiceNumber}</p>
          <p className="tabular text-4xl leading-tight font-bold tracking-tight">{formatINR(bill.totalPaise)}</p>
        </div>

        {bill.changePaise > 0 ? (
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900" role="status">
            <span className="text-lg font-medium">Return to customer</span>
            <span className="tabular text-3xl font-bold">{formatINR(bill.changePaise)}</span>
          </div>
        ) : null}

        {bill.queued ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-base text-amber-900" role="status">
            <CloudOff className="mt-1 size-4 shrink-0" aria-hidden />
            <span>
              No internet, so this bill is only on this phone. It goes to the server by itself when the internet is back. There is no share link until then.
              Print it now and carry on.
            </span>
          </p>
        ) : null}

        {bill.duplicate || bill.warnings.length > 0 ? (
          <ul className="grid gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
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

        <div className="grid gap-2">
          <Button type="button" variant="outline" className="h-14 text-lg" onClick={() => openPrint(bill, settings, printQueuedBill)}>
            <Printer className="size-5" aria-hidden /> Print
          </Button>

          {online ? (
            <>
              {!knownPhone ? (
                <div className="grid gap-1.5">
                  <label htmlFor="pos-success-phone" className="text-sm font-medium">
                    Customer&apos;s WhatsApp number
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted-foreground" aria-hidden>
                      +91
                    </span>
                    <input
                      id="pos-success-phone"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="off"
                      enterKeyHint="done"
                      placeholder="10-digit number"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(-12))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      className="tabular h-12 w-full rounded-xl border border-input bg-background pr-3 pl-14 text-lg tracking-wide outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  </div>
                </div>
              ) : null}
              {sendTo ? (
                <Button asChild className="h-14 bg-[#1f8f4e] text-lg text-white hover:bg-[#1a7a43]">
                  <a href={whatsappUrl(message, sendTo)} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="size-5" aria-hidden /> Send on WhatsApp
                  </a>
                </Button>
              ) : (
                <Button type="button" className="h-14 text-lg" disabled>
                  <MessageCircle className="size-5" aria-hidden /> Send on WhatsApp
                </Button>
              )}
              <p className="-mt-1 text-center text-sm text-muted-foreground">
                {knownPhone ? `To ${formatMobile(knownPhone)}` : sendTo ? `To ${formatMobile(sendTo)}` : "Type the number above to send the bill on WhatsApp."}
              </p>
              <Button type="button" variant="outline" className="h-14 text-lg" onClick={() => void share()}>
                <Share2 className="size-5" aria-hidden /> Share
              </Button>
              <a
                href={`/api/invoices/${bill.invoiceId}/pdf`}
                target="_blank"
                rel="noopener"
                className="inline-flex h-11 items-center justify-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <FileText className="size-4" aria-hidden /> Open A4 PDF
              </a>
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
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void sendEmail();
            }}
          >
            <label htmlFor="pos-success-email" className="text-sm font-medium">
              Email the bill <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <div className="flex gap-2">
              <Input
                id="pos-success-email"
                type="email"
                inputMode="email"
                placeholder="customer@example.com"
                value={email}
                disabled={emailState !== "idle"}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 min-w-0 flex-1 rounded-xl text-base"
              />
              <Button type="submit" variant="outline" className="h-12 px-4 text-base" disabled={emailState !== "idle" || !email.trim()}>
                {emailState === "sending" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Mail aria-hidden />}
                {emailState === "sent" ? "Sent" : "Send"}
              </Button>
            </div>
          </form>
        ) : null}

        <section className="grid gap-2 rounded-xl border p-3" aria-label="Photo of items given">
          <p className="flex items-center gap-1.5 text-base font-medium">
            <Camera className="size-4 text-muted-foreground" aria-hidden /> Photo of items given <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          {online ? (
            <SalePhotoUploader businessId={settings.businessId} invoiceId={bill.invoiceId} onBusyChange={onPhotoBusy} />
          ) : (
            <p className="text-sm text-muted-foreground">This bill is saved on this phone only. Add photos from the bill in Sales once it has synced.</p>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="button" size="lg" autoFocus className="h-14 w-full text-lg" onClick={onNewBill} disabled={photoBusy}>
          {photoBusy ? (
            <>
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> Saving photo…
            </>
          ) : (
            "New bill"
          )}
        </Button>
      </div>
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
  variant = "dialog",
}: {
  bill: PostedBill | null;
  settings: PosSettings;
  sendEmailReceipt: PosServices["sendEmailReceipt"];
  printQueuedBill?: PosServices["printQueuedBill"];
  onNewBill: () => void;
  /** After the dialog has closed, e.g. to put focus back in the search box. Return false to let focus go back where it was. */
  onClosed: () => boolean | void;
  /** "screen": the full-screen phone panel. */
  variant?: "dialog" | "screen";
}) {
  // A photo still uploading must finish before the panel closes, or it would be lost.
  const [photoBusy, setPhotoBusy] = useState(false);

  if (variant === "screen") {
    return (
      <Dialog open={bill !== null} onOpenChange={(open) => !open && !photoBusy && onNewBill()}>
        <DialogContent
          showCloseButton={false}
          className="inset-0 top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none motion-reduce:animate-none!"
          onCloseAutoFocus={(e) => {
            if (onClosed() !== false) e.preventDefault();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => photoBusy && e.preventDefault()}
        >
          <DialogTitle className="sr-only">{bill?.queued ? "Saved on this phone, will sync" : "Bill saved"}</DialogTitle>
          <DialogDescription className="sr-only">{bill ? `${DOCUMENT_TITLES[bill.documentType]} ${bill.invoiceNumber}` : ""}</DialogDescription>
          {bill ? (
            <MobileSuccessBody
              key={bill.invoiceId}
              bill={bill}
              settings={settings}
              sendEmailReceipt={sendEmailReceipt}
              printQueuedBill={printQueuedBill}
              onNewBill={onNewBill}
              photoBusy={photoBusy}
              onPhotoBusy={setPhotoBusy}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={bill !== null} onOpenChange={(open) => !open && !photoBusy && onNewBill()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (onClosed() !== false) e.preventDefault();
        }}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => photoBusy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{bill?.queued ? "Saved offline, will sync" : "Bill saved"}</DialogTitle>
          <DialogDescription>
            {bill ? `${DOCUMENT_TITLES[bill.documentType]}${bill.queued ? ". Not on the server yet." : ""}` : ""}
          </DialogDescription>
        </DialogHeader>
        {bill ? (
          <SuccessBody
            key={bill.invoiceId}
            bill={bill}
            settings={settings}
            sendEmailReceipt={sendEmailReceipt}
            printQueuedBill={printQueuedBill}
            onNewBill={onNewBill}
            photoBusy={photoBusy}
            onPhotoBusy={setPhotoBusy}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
