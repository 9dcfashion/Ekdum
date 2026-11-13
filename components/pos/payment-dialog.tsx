"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { toDataURL } from "qrcode";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { MoneyInput } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isValidMobile, upiPaymentUri } from "@/lib/gst";
import { formatINR, paiseToRupees, rupeesToPaise } from "@/lib/money";
import { cashSettlement, checkPayments, type BuildSaleOptions, type CartSummary } from "@/lib/pos/cart";
import type { CartState, PaymentEntry, PosSettings } from "@/lib/pos/types";
import type { PaymentMode } from "@/lib/types/db";
import { cn } from "@/lib/utils";
import { Kbd } from "./shortcut-legend";

const MODES: Array<{ mode: PaymentMode; label: string; reference?: string }> = [
  { mode: "cash", label: "Cash" },
  { mode: "upi", label: "UPI", reference: "UPI reference" },
  { mode: "card", label: "Card", reference: "Last 4 digits or slip number" },
  { mode: "bank_transfer", label: "Bank transfer", reference: "Transfer reference" },
  { mode: "credit", label: "Credit (pay later)" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PaymentConfirmation {
  payments: PaymentEntry[];
  options: BuildSaleOptions;
  /** Email typed in the dialog (saved on the bill when a receipt is requested). */
  email: string;
  changePaise: number;
}

export interface PayError {
  code: string;
  message: string;
}

const blank = (): Record<PaymentMode, string> => ({ cash: "", upi: "", card: "", bank_transfer: "", credit: "" });

function errorHelp(code: string): { hint: string; refresh?: boolean } {
  switch (code) {
    case "totals_mismatch":
      return { hint: "A price or tax rate may have changed since this screen was opened. Refresh the catalog, review the bill and try again.", refresh: true };
    case "price_override_denied":
      return { hint: "The price of an item may have changed since this screen was opened. Refresh the catalog and try again.", refresh: true };
    case "insufficient_stock":
      return { hint: "Reduce the quantity or remove the item, then try again.", refresh: true };
    case "discount_over_limit":
      return { hint: "Lower the discount, or ask someone with a higher limit to make this bill." };
    case "series_missing":
      return { hint: "Bill numbers are not set up for this outlet. Ask the owner to add a series in Settings." };
    case "offline_unavailable":
      return { hint: "The bill is still on screen. Nothing was saved." };
    case "network":
      return { hint: "Nothing is lost. Press Enter to try again. The bill cannot be saved twice." };
    case "server_error":
    case "number_conflict":
      return { hint: "Nothing is lost. Try again. The bill cannot be saved twice." };
    default:
      return { hint: "Fix this and try again." };
  }
}

/** QR for the exact UPI amount. The box has a fixed size, so the dialog never jumps. */
function UpiQr({ uri }: { uri: string | null }) {
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    toDataURL(uri, { margin: 1, width: 320, errorCorrectionLevel: "M" }).then(
      (dataUrl) => !cancelled && setQr({ uri, dataUrl }),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const ready = uri && qr?.uri === uri ? qr.dataUrl : null;
  return (
    <div className="flex size-40 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white">
      {ready ? (
        <Image src={ready} alt="UPI QR code for the exact amount" width={160} height={160} unoptimized />
      ) : (
        <p className="px-3 text-center text-xs text-muted-foreground">{uri ? "Making the QR code…" : "Enter a UPI amount to show the QR code"}</p>
      )}
    </div>
  );
}

function PaymentForm({
  cart,
  summary,
  settings,
  posting,
  error,
  onConfirm,
  onCancel,
  onRefreshCatalog,
}: {
  cart: CartState;
  summary: CartSummary;
  settings: PosSettings;
  posting: boolean;
  error: PayError | null;
  onConfirm: (confirmation: PaymentConfirmation) => void;
  onCancel: () => void;
  onRefreshCatalog?: () => void;
}) {
  const total = summary.totals.totalPaise;
  const customer = cart.customer;
  const hasRecord = !!customer?.id;
  const phoneOk = hasRecord && isValidMobile(customer.phone);
  const alreadyOptedIn = !!customer?.whatsapp_opt_in;

  const [amounts, setAmounts] = useState<Record<PaymentMode, string>>(() => ({ ...blank(), cash: total > 0 ? paiseToRupees(total) : "" }));
  const [references, setReferences] = useState<Record<PaymentMode, string>>(blank);
  const [tendered, setTendered] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [email, setEmail] = useState(customer?.email ?? "");
  const [sendWhatsapp, setSendWhatsapp] = useState(false);
  const [consent, setConsent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const parsed = MODES.map(({ mode }) => {
    const text = amounts[mode].trim();
    const paise = text === "" ? 0 : rupeesToPaise(text);
    return { mode, paise, valid: paise !== null && paise >= 0 };
  });
  const invalidAmount = parsed.some((p) => !p.valid);
  const entries: PaymentEntry[] = parsed.map((p) => ({ mode: p.mode, amountPaise: p.paise ?? 0, reference: references[p.mode] }));
  const check = checkPayments(total, entries, { hasCustomerRecord: hasRecord });
  const paiseOf = (mode: PaymentMode) => entries.find((e) => e.mode === mode)?.amountPaise ?? 0;

  const cashPaise = paiseOf("cash");
  const tenderedPaise = tendered.trim() === "" ? cashPaise : rupeesToPaise(tendered);
  const tenderedInvalid = tenderedPaise === null || tenderedPaise < 0;
  const settlement = cashSettlement(cashPaise, tenderedInvalid ? 0 : tenderedPaise);

  const upiPaise = paiseOf("upi");
  const upiUri =
    settings.upiId && upiPaise > 0 && !invalidAmount
      ? upiPaymentUri({ upiId: settings.upiId, payeeName: settings.businessName, amountPaise: upiPaise, note: "Bill payment" })
      : null;

  function setOnly(mode: PaymentMode) {
    setAmounts({ ...blank(), [mode]: total > 0 ? paiseToRupees(total) : "" });
    setTendered("");
    setFormError(null);
  }

  function addBalance(mode: PaymentMode) {
    if (check.remainingPaise <= 0) return;
    setAmounts({ ...amounts, [mode]: paiseToRupees(paiseOf(mode) + check.remainingPaise) });
    setFormError(null);
  }

  function submit() {
    if (posting) return;
    if (invalidAmount) return setFormError("Enter valid payment amounts");
    if (!check.ok) return setFormError(check.error);
    if (cashPaise > 0 && tenderedInvalid) return setFormError("Enter a valid cash amount received");
    if (cashPaise > 0 && settlement.shortPaise > 0) return setFormError(`Cash received is short by ${formatINR(settlement.shortPaise)}`);
    if (sendEmail && !EMAIL_PATTERN.test(email.trim())) return setFormError("Enter a valid email address to send the bill to");
    if (sendWhatsapp && !alreadyOptedIn && !consent) return setFormError("Tick the consent box to send the bill on WhatsApp");
    setFormError(null);
    onConfirm({
      payments: entries.filter((e) => e.amountPaise > 0),
      options: { notifyEmail: sendEmail, notifyWhatsapp: sendWhatsapp && phoneOk, whatsappOptIn: sendWhatsapp && !alreadyOptedIn && consent },
      email: sendEmail ? email.trim() : "",
      changePaise: cashPaise > 0 ? settlement.changePaise : 0,
    });
  }

  const help = error ? errorHelp(error.code) : null;
  const balanceText =
    check.remainingPaise === 0 ? "Fully covered" : check.remainingPaise > 0 ? `${formatINR(check.remainingPaise)} still to add` : `${formatINR(-check.remainingPaise)} too much`;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset disabled={posting} className="grid gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
          <div>
            <p className="text-xs text-muted-foreground">To collect</p>
            <p className="tabular text-3xl leading-tight font-semibold tracking-tight">{formatINR(total)}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" onClick={() => setOnly("cash")}>
              Exact cash
            </Button>
            <Button type="button" variant="outline" onClick={() => setOnly("upi")}>
              Full UPI
            </Button>
            <Button type="button" variant="outline" onClick={() => setOnly("card")}>
              Full card
            </Button>
            {hasRecord ? (
              <Button type="button" variant="outline" onClick={() => setOnly("credit")}>
                Full credit
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid content-start gap-2">
            {MODES.map(({ mode, label, reference }) => {
              const disabled = mode === "credit" && !hasRecord;
              const row = parsed.find((p) => p.mode === mode);
              return (
                <div key={mode} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[7.5rem_8rem_minmax(0,1fr)_auto]">
                  <label htmlFor={`pos-pay-${mode}`} className={cn("text-sm font-medium", disabled && "text-muted-foreground")}>
                    {label}
                  </label>
                  <MoneyInput
                    id={`pos-pay-${mode}`}
                    disabled={disabled}
                    placeholder="0.00"
                    aria-invalid={row && !row.valid ? true : undefined}
                    value={amounts[mode]}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      setAmounts({ ...amounts, [mode]: e.target.value });
                      setFormError(null);
                    }}
                    className="h-9 text-right"
                  />
                  <div className="col-span-3 col-start-1 row-start-2 sm:col-span-1 sm:col-start-3 sm:row-start-1">
                    {reference ? (
                      <Input
                        aria-label={`${label}: ${reference}`}
                        placeholder={`${reference} (optional)`}
                        maxLength={100}
                        value={references[mode]}
                        onChange={(e) => setReferences({ ...references, [mode]: e.target.value })}
                        className={cn("h-9", paiseOf(mode) > 0 ? "" : "hidden sm:invisible sm:block")}
                        tabIndex={paiseOf(mode) > 0 ? 0 : -1}
                      />
                    ) : disabled ? (
                      <p className="text-xs text-muted-foreground">Add a saved customer to give credit.</p>
                    ) : mode === "credit" ? (
                      <p className="truncate text-xs text-muted-foreground">Due from {customer?.name || "the customer"}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    tabIndex={-1}
                    disabled={disabled || check.remainingPaise <= 0}
                    onClick={() => addBalance(mode)}
                    aria-label={`Put the remaining amount on ${label}`}
                    className="col-start-3 row-start-1 sm:col-start-4"
                  >
                    Balance
                  </Button>
                </div>
              );
            })}
            <p
              className={cn("tabular h-5 text-right text-sm font-medium", check.remainingPaise === 0 ? "text-emerald-700" : "text-destructive")}
              aria-live="polite"
            >
              {balanceText}
            </p>
          </div>

          <div className="flex flex-row gap-3 md:w-40 md:flex-col">
            {settings.upiId ? <UpiQr uri={upiUri} /> : null}
            <div className="grid min-w-0 flex-1 content-start gap-1.5">
              <label htmlFor="pos-tendered" className="text-sm font-medium">
                Cash received
              </label>
              <MoneyInput
                id="pos-tendered"
                autoFocus
                disabled={cashPaise <= 0}
                placeholder={cashPaise > 0 ? paiseToRupees(cashPaise) : "0.00"}
                aria-invalid={cashPaise > 0 && (tenderedInvalid || settlement.shortPaise > 0) ? true : undefined}
                value={tendered}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  setTendered(e.target.value);
                  setFormError(null);
                }}
                className="h-9 text-right"
              />
              <p className="text-xs text-muted-foreground">Change to give back</p>
              <p className={cn("tabular text-2xl leading-none font-semibold", settlement.shortPaise > 0 && cashPaise > 0 && "text-destructive")} aria-live="polite">
                {cashPaise > 0 && settlement.shortPaise > 0 ? `Short ${formatINR(settlement.shortPaise)}` : formatINR(cashPaise > 0 ? settlement.changePaise : 0)}
              </p>
            </div>
          </div>
        </div>

        {settings.emailReceiptsEnabled || settings.whatsappReceiptsEnabled ? (
          <div className="grid gap-2 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">Send the bill</p>
            {settings.whatsappReceiptsEnabled ? (
              <div className="grid gap-1.5">
                <label className={cn("flex items-center gap-2 text-sm", !phoneOk && "text-muted-foreground")}>
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    disabled={!phoneOk}
                    checked={sendWhatsapp && phoneOk}
                    onChange={(e) => {
                      setSendWhatsapp(e.target.checked);
                      setFormError(null);
                    }}
                  />
                  Send on WhatsApp
                  {!phoneOk ? <span className="text-xs">(needs a saved customer with a mobile number)</span> : null}
                </label>
                {phoneOk && !alreadyOptedIn && sendWhatsapp ? (
                  <label className="ml-6 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={consent}
                      onChange={(e) => {
                        setConsent(e.target.checked);
                        setFormError(null);
                      }}
                    />
                    Customer agrees to receive bills on WhatsApp
                  </label>
                ) : null}
              </div>
            ) : null}
            {settings.emailReceiptsEnabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={sendEmail}
                    onChange={(e) => {
                      setSendEmail(e.target.checked);
                      setFormError(null);
                    }}
                  />
                  Send by email
                </label>
                <Input
                  type="email"
                  inputMode="email"
                  aria-label="Email address for the bill"
                  placeholder="customer@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setSendEmail(e.target.value.trim() !== "");
                    setFormError(null);
                  }}
                  className="h-8 min-w-0 flex-1"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {/* Fixed-height message area: errors never push the buttons around. */}
      <div className="mt-3 min-h-14" aria-live="assertive">
        {formError ? (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {formError}
          </p>
        ) : error && help ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-destructive">{error.message}</p>
              <p className="text-muted-foreground">{help.hint}</p>
            </div>
            {help.refresh && onRefreshCatalog ? (
              <Button type="button" variant="outline" size="sm" onClick={onRefreshCatalog} disabled={posting}>
                <RefreshCw aria-hidden /> Refresh catalog
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" className="h-11" onClick={onCancel} disabled={posting}>
          Back to bill
        </Button>
        <Button type="submit" size="lg" className="h-11 min-w-44 text-base" disabled={posting} aria-busy={posting}>
          {posting ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {posting ? "Saving the bill…" : error ? "Try again" : "Save bill"}
          {!posting ? <Kbd>Enter</Kbd> : null}
        </Button>
      </div>
    </form>
  );
}

/** Take payment (F9): split modes, cash change, UPI QR, credit and receipt options. */
export function PaymentDialog({
  open,
  onOpenChange,
  onClosed,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  cart: CartState;
  summary: CartSummary;
  settings: PosSettings;
  posting: boolean;
  error: PayError | null;
  onConfirm: (confirmation: PaymentConfirmation) => void;
  onRefreshCatalog?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (form.posting ? undefined : onOpenChange(next))}>
      <DialogContent
        showCloseButton={!form.posting}
        className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed();
        }}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>Split across modes if needed. The amounts must add up to the bill total.</DialogDescription>
        </DialogHeader>
        {open ? <PaymentForm {...form} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
