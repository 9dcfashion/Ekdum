"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Banknote, Check, CreditCard, Loader2, RefreshCw, Smartphone, SplitSquareHorizontal, UserPlus, UserRound, Wallet } from "lucide-react";
import { MoneyInput } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { formatMobile, isValidMobile, normaliseMobile, upiPaymentUri } from "@/lib/gst";
import { formatINR, rupeesToPaise } from "@/lib/money";
import type { CartSummary } from "@/lib/pos/cart";
import { cashChips, shortINR } from "@/lib/pos/quick-bill";
import type { CartState, PosCustomer, PosServices, PosSettings } from "@/lib/pos/types";
import type { PaymentMode } from "@/lib/types/db";
import { cn } from "@/lib/utils";
import { UpiQr, errorHelp, type CustomerChoice, type PayError, type PaymentConfirmation } from "./payment-dialog";
import { useKeyboardInset } from "./use-quick-bill";

type QuickMode = Extract<PaymentMode, "cash" | "upi" | "card" | "credit">;

const MODE_LABEL: Record<QuickMode, string> = { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit" };
const LOOKUP_DELAY_MS = 300;

/** The 10 digits of an Indian mobile, from whatever was typed or pasted. */
function mobileDigits(text: string | null | undefined): string {
  const normalised = normaliseMobile(text);
  if (normalised) return normalised.slice(3);
  return (text ?? "").replace(/\D/g, "").slice(0, 10);
}

interface Lookup {
  digits: string;
  state: "searching" | "found" | "none" | "error";
  match: PosCustomer | null;
}

function QuickPayForm({
  cart,
  summary,
  settings,
  services,
  posting,
  error,
  onConfirm,
  onSplit,
  onOpenCustomer,
  onRefreshCatalog,
}: {
  cart: CartState;
  summary: CartSummary;
  settings: PosSettings;
  services: Pick<PosServices, "searchCustomers" | "createCustomer">;
  posting: boolean;
  error: PayError | null;
  onConfirm: (confirmation: PaymentConfirmation) => void;
  onSplit: (customer: CustomerChoice | undefined) => void;
  onOpenCustomer: () => void;
  onRefreshCatalog?: () => void;
}) {
  const total = summary.totals.totalPaise;
  const customer = cart.customer;
  // A saved customer, or a B2B bill, is managed in the customer dialog; otherwise just a mobile number here.
  const showSummary = !!customer?.id || cart.supplyType === "b2b";
  const startDigits = mobileDigits(customer?.phone);

  const [mode, setMode] = useState<QuickMode | null>(null);
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [phone, setPhone] = useState(startDigits);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const current = lookup && lookup.digits === phone ? lookup : null;
  const match = current?.match ?? null;
  const hasRecord = !!customer?.id || !!match?.id;
  const phoneValid = isValidMobile(phone);

  const tenderedPaise = tendered.trim() === "" ? null : rupeesToPaise(tendered);
  const tenderedInvalid = tendered.trim() !== "" && (tenderedPaise === null || tenderedPaise < 0);
  const change = tenderedPaise !== null && !tenderedInvalid ? tenderedPaise - total : null;
  const chips = cashChips(total);
  const upiUri = settings.upiId && total > 0 ? upiPaymentUri({ upiId: settings.upiId, payeeName: settings.businessName, amountPaise: total, note: "Bill payment" }) : null;

  function typePhone(text: string) {
    const digits = mobileDigits(text);
    setPhone(digits);
    setAdding(false);
    setFormError(null);
    if (timer.current) clearTimeout(timer.current);
    const request = ++latest.current;
    if (!isValidMobile(digits) || !settings.canViewCustomers) {
      setLookup(null);
      return;
    }
    setLookup({ digits, state: "searching", match: null });
    timer.current = setTimeout(async () => {
      const result = await services.searchCustomers(digits);
      if (request !== latest.current) return; // the number changed meanwhile
      if (!result.ok) return setLookup({ digits, state: "error", match: null });
      const wanted = normaliseMobile(digits);
      const found = result.data.find((c) => normaliseMobile(c.phone) === wanted) ?? null;
      setLookup({ digits, state: found ? "found" : "none", match: found });
    }, LOOKUP_DELAY_MS);
  }

  async function saveNewCustomer() {
    if (savingCustomer) return;
    if (!newName.trim()) return setFormError("Type the customer's name to save them");
    setSavingCustomer(true);
    const result = await services.createCustomer({ name: newName.trim(), phone });
    setSavingCustomer(false);
    if (!result.ok) return setFormError(result.error);
    toast.success(result.data.id ? "Customer saved" : "Added to this bill only. Save the customer when you are back online.");
    setLookup({ digits: phone, state: "found", match: result.data });
    setAdding(false);
    setFormError(null);
  }

  /** What to put on the bill from the mobile field. Undefined when nothing changed. */
  function customerChoice(): CustomerChoice | undefined {
    if (showSummary) return undefined;
    if (match) return { kind: "record", record: match };
    if (phone === startDigits) return undefined;
    return { kind: "phone", phone: phoneValid ? (normaliseMobile(phone) ?? "") : "" };
  }

  function phoneProblem(): string | null {
    return !showSummary && phone !== "" && !phoneValid ? "The mobile number needs all 10 digits. Fix it, or clear it to skip." : null;
  }

  function save() {
    if (posting) return;
    if (!mode) return setFormError("Choose how the customer paid: Cash, UPI or Card.");
    const problem = phoneProblem();
    if (problem) return setFormError(problem);
    if (mode === "credit" && !hasRecord) return setFormError("Credit needs a saved customer. Find or add the customer first.");
    let changePaise = 0;
    if (mode === "cash" && tendered.trim() !== "") {
      if (tenderedPaise === null || tenderedInvalid) return setFormError("Enter the amount the customer gave, or leave it empty.");
      if (tenderedPaise < total) return setFormError(`The customer gave ${formatINR(total - tenderedPaise)} less than the bill.`);
      changePaise = tenderedPaise - total;
    }
    setFormError(null);
    onConfirm({
      payments: [{ mode, amountPaise: total, reference: mode === "upi" || mode === "card" ? reference : "" }],
      options: {},
      email: "",
      changePaise,
      customer: customerChoice(),
    });
  }

  function split() {
    const problem = phoneProblem();
    if (problem) return setFormError(problem);
    onSplit(customerChoice());
  }

  const help = error ? errorHelp(error.code) : null;
  const choose = (next: QuickMode) => {
    setMode(next);
    setFormError(null);
  };

  const modeButton = (value: Exclude<QuickMode, "credit">, label: string, Icon: typeof Banknote) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => choose(value)}
      className={cn(
        "relative flex h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-lg font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        mode === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
      )}
    >
      <Icon className="size-7" aria-hidden />
      {label}
      {mode === value ? <Check className="absolute top-1.5 right-1.5 size-4" aria-hidden /> : null}
    </button>
  );

  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset
        disabled={posting}
        className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain p-4 pb-6"
        onKeyDown={(e) => {
          // The keyboard's Enter / Done key only closes the keyboard here: saving the bill is always a deliberate tap.
          if (e.key === "Enter" && !e.defaultPrevented && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            e.target.blur();
          }
        }}
      >
        <div className="text-center">
          <p className="text-sm text-muted-foreground">To collect</p>
          <p className="tabular text-4xl leading-tight font-bold tracking-tight">{formatINR(total)}</p>
          <p className="text-sm text-muted-foreground">
            {summary.itemCount} {summary.itemCount === 1 ? "item" : "items"}
          </p>
        </div>

        <div className="grid gap-2" role="group" aria-labelledby="pos-quick-pay-how">
          <p id="pos-quick-pay-how" className="text-base font-medium">
            How did the customer pay?
          </p>
          <div className="grid grid-cols-3 gap-2">
            {modeButton("cash", "Cash", Banknote)}
            {modeButton("upi", "UPI", Smartphone)}
            {modeButton("card", "Card", CreditCard)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-auto min-h-12 py-2 text-base leading-tight whitespace-normal" onClick={split}>
              <SplitSquareHorizontal aria-hidden /> Split payment
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-pressed={mode === "credit"}
              className={cn("h-auto min-h-12 py-2 text-base leading-tight whitespace-normal", mode === "credit" && "border-primary bg-primary/10 text-foreground")}
              onClick={() => choose("credit")}
            >
              <Wallet aria-hidden /> Credit (udhaar)
            </Button>
          </div>
        </div>

        {mode === "cash" ? (
          <div className="grid gap-3 rounded-xl border bg-background p-3">
            <p className="text-base font-medium">
              Customer gave <span className="font-normal text-muted-foreground">(optional)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {chips.map((paise, i) => (
                <button
                  key={paise}
                  type="button"
                  aria-pressed={tenderedPaise === paise}
                  onClick={() => {
                    setTendered((paise / 100).toFixed(2));
                    setFormError(null);
                  }}
                  className={cn(
                    "tabular h-12 min-w-20 rounded-full border-2 px-4 text-base font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    tenderedPaise === paise ? "border-primary bg-primary/10" : "border-border bg-background",
                  )}
                >
                  {i === 0 ? `Exact ${shortINR(paise)}` : shortINR(paise)}
                </button>
              ))}
            </div>
            <MoneyInput
              aria-label="Other amount the customer gave"
              placeholder="Other amount"
              enterKeyHint="done"
              value={tendered}
              aria-invalid={tenderedInvalid || (change !== null && change < 0) ? true : undefined}
              onChange={(e) => {
                setTendered(e.target.value);
                setFormError(null);
              }}
              className="h-12 rounded-xl text-right text-lg md:text-lg"
            />
            <div
              className={cn(
                "flex items-baseline justify-between gap-3 rounded-xl px-3 py-2.5",
                change !== null && change < 0 ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-900",
              )}
              aria-live="polite"
            >
              {change === null ? (
                <span className="text-sm text-muted-foreground">Tap what the customer gave to see the change.</span>
              ) : change < 0 ? (
                <>
                  <span className="text-base font-medium">Short</span>
                  <span className="tabular text-3xl font-bold">{formatINR(-change)}</span>
                </>
              ) : (
                <>
                  <span className="text-base font-medium">Return</span>
                  <span className="tabular text-3xl font-bold">{formatINR(change)}</span>
                </>
              )}
            </div>
          </div>
        ) : null}

        {mode === "upi" ? (
          <div className="grid justify-items-center gap-3 rounded-xl border bg-background p-3 text-center">
            {upiUri ? (
              <>
                <UpiQr uri={upiUri} large />
                <p className="text-base">
                  Ask the customer to scan and pay <span className="font-semibold">{formatINR(total)}</span>.
                </p>
                <p className="text-sm text-muted-foreground">Save the bill after the money shows in your UPI app.</p>
              </>
            ) : (
              <p className="text-base">
                Check that <span className="font-semibold">{formatINR(total)}</span> has reached your UPI app, then save the bill.
              </p>
            )}
            <Input
              aria-label="UPI reference number (optional)"
              placeholder="UPI reference (optional)"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-12 rounded-xl text-base"
            />
          </div>
        ) : null}

        {mode === "card" ? (
          <div className="grid gap-3 rounded-xl border bg-background p-3">
            <p className="text-base">
              Take <span className="font-semibold">{formatINR(total)}</span> on the card machine, then save the bill.
            </p>
            <Input
              aria-label="Last 4 digits of the card or slip number (optional)"
              placeholder="Last 4 digits or slip number (optional)"
              maxLength={100}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-12 rounded-xl text-base"
            />
          </div>
        ) : null}

        {mode === "credit" ? (
          <div className="grid gap-3 rounded-xl border bg-background p-3">
            {hasRecord ? (
              <p className="text-base">
                <span className="font-semibold">{formatINR(total)}</span> will be added to what{" "}
                <span className="font-semibold">{customer?.id ? customer.name : match?.name}</span> owes you.
              </p>
            ) : (
              <>
                <p className="text-base">Credit needs a saved customer. Type their mobile number below to find them, or find them by name.</p>
                <Button type="button" variant="outline" className="h-12 text-base" onClick={onOpenCustomer}>
                  <UserRound aria-hidden /> Find or add customer
                </Button>
              </>
            )}
          </div>
        ) : null}

        <section className="grid gap-2 rounded-xl border bg-background p-3" aria-label="Customer">
          {showSummary ? (
            <div className="flex items-center gap-3">
              <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{customer?.name || (customer?.phone ? formatMobile(customer.phone) : "No customer yet")}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {[customer?.phone && customer.name ? formatMobile(customer.phone) : null, customer?.gstin || null].filter(Boolean).join(" · ") ||
                    (cart.supplyType === "b2b" ? "B2B bill" : "Saved customer")}
                </p>
              </div>
              <Button type="button" variant="outline" className="h-11 px-4 text-base" onClick={onOpenCustomer}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <label htmlFor="pos-quick-phone" className="text-base font-medium">
                Customer mobile <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg text-muted-foreground" aria-hidden>
                  +91
                </span>
                <input
                  id="pos-quick-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="10-digit number"
                  aria-describedby="pos-quick-phone-status"
                  aria-invalid={phone !== "" && !phoneValid && phone.length === 10 ? true : undefined}
                  value={phone}
                  onChange={(e) => typePhone(e.target.value)}
                  className="tabular h-12 w-full rounded-xl border border-input bg-background pr-3 pl-14 text-lg tracking-wide outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                />
              </div>
              <p id="pos-quick-phone-status" className="min-h-5 text-sm" aria-live="polite">
                {phone === "" ? (
                  <span className="text-muted-foreground">So you can send the bill on WhatsApp.</span>
                ) : !phoneValid ? (
                  <span className="text-muted-foreground">{phone.length < 10 ? `${10 - phone.length} more ${10 - phone.length === 1 ? "digit" : "digits"}` : "This is not a valid mobile number."}</span>
                ) : current?.state === "searching" ? (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Looking for this customer…
                  </span>
                ) : match ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                    <Check className="size-4" aria-hidden /> {match.name}
                    {match.id ? " (saved customer)" : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {current?.state === "error" ? "Could not check the number. It will still be printed on the bill." : "New number. It is printed on this bill."}
                  </span>
                )}
              </p>
              {phoneValid && current?.state === "none" && settings.canManageCustomers ? (
                adding ? (
                  <div className="grid gap-2">
                    <label htmlFor="pos-quick-new-name" className="text-sm font-medium">
                      Customer name
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="pos-quick-new-name"
                        autoFocus
                        autoComplete="off"
                        maxLength={150}
                        value={newName}
                        onChange={(e) => {
                          setNewName(e.target.value);
                          setFormError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveNewCustomer();
                          }
                        }}
                        className="h-12 min-w-0 flex-1 rounded-xl text-base"
                      />
                      <Button type="button" className="h-12 px-4 text-base" onClick={() => void saveNewCustomer()} disabled={savingCustomer}>
                        {savingCustomer ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="ghost" className="h-11 justify-start px-1 text-base text-primary" onClick={() => setAdding(true)}>
                    <UserPlus aria-hidden /> Save as a new customer
                  </Button>
                )
              ) : null}
            </>
          )}
        </section>
      </fieldset>

      <div className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div aria-live="assertive">
          {formError ? (
            <p className="mb-2 flex items-start gap-2 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {formError}
            </p>
          ) : error && help ? (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-destructive">{error.message}</p>
                <p className="text-muted-foreground">{help.hint}</p>
              </div>
              {help.refresh && onRefreshCatalog ? (
                <Button type="button" variant="outline" className="h-10" onClick={onRefreshCatalog} disabled={posting}>
                  <RefreshCw aria-hidden /> Refresh
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="h-14 w-full text-lg" disabled={posting || !mode} aria-busy={posting}>
          {posting ? (
            <>
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> Saving the bill…
            </>
          ) : !mode ? (
            "Choose Cash, UPI or Card"
          ) : error ? (
            "Try again"
          ) : (
            `Save bill (${MODE_LABEL[mode]})`
          )}
        </Button>
      </div>
    </form>
  );
}

/** The phone pay screen: big Cash, UPI and Card buttons for the full amount; split and credit are one step away. */
export function QuickPaySheet({
  open,
  onOpenChange,
  ...form
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartState;
  summary: CartSummary;
  settings: PosSettings;
  services: Pick<PosServices, "searchCustomers" | "createCustomer">;
  posting: boolean;
  error: PayError | null;
  onConfirm: (confirmation: PaymentConfirmation) => void;
  /** Open the full payment dialog (split across modes), after putting the customer from the mobile field on the bill. */
  onSplit: (customer: CustomerChoice | undefined) => void;
  onOpenCustomer: () => void;
  onRefreshCatalog?: () => void;
}) {
  const inset = useKeyboardInset();
  return (
    <Sheet open={open} onOpenChange={(next) => (form.posting ? undefined : onOpenChange(next))}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        style={{ bottom: inset, height: `calc(100dvh - ${inset}px)` }}
        className="gap-0 bg-muted/40 data-[side=bottom]:border-t-0 motion-reduce:animate-none!"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 border-b bg-background px-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={form.posting}
            aria-label="Back to the bill"
            className="flex size-12 items-center justify-center rounded-xl outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <ArrowLeft className="size-6" aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-lg font-semibold">Pay</SheetTitle>
            <SheetDescription className="sr-only">Choose how the customer paid, then save the bill.</SheetDescription>
          </div>
        </div>
        {open ? <QuickPayForm {...form} /> : null}
      </SheetContent>
    </Sheet>
  );
}
