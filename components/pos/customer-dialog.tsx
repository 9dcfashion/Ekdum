"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/shared/field";
import { StateSelect } from "@/components/shared/state-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMobile, isValidMobile, stateLabel, validateGstin } from "@/lib/gst";
import {
  customerFromRecord,
  patchCustomer,
  setCustomer,
  setDeliveryState,
  setPlaceOfSupplyOverride,
  setSupplyType,
  walkInCustomer,
  type CartSummary,
} from "@/lib/pos/cart";
import type { CartCustomer, CartState, PosCustomer, PosServices, PosSettings } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import { SupplyTypeToggle } from "./bill-summary";

const SEARCH_DELAY_MS = 250;

/** Phone / name lookup with debounce, keyboard navigation and quick-add. */
function CustomerLookup({
  settings,
  services,
  onPick,
}: {
  settings: PosSettings;
  services: Pick<PosServices, "searchCustomers" | "createCustomer">;
  onPick: (customer: PosCustomer) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosCustomer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [adding, setAdding] = useState<{ name: string; phone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function search(text: string) {
    setQuery(text);
    setHighlight(0);
    setAdding(null);
    if (timer.current) clearTimeout(timer.current);
    const term = text.trim();
    const request = ++latest.current;
    if (term.length < 2) {
      setResults(null);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const result = await services.searchCustomers(term);
      if (request !== latest.current) return; // a newer search is already running
      setSearching(false);
      if (result.ok) {
        setResults(result.data);
        setError(null);
      } else {
        setResults(null);
        setError(result.error);
      }
    }, SEARCH_DELAY_MS);
  }

  function startAdding() {
    const term = query.trim();
    const digits = term.replace(/\D/g, "");
    setAdding(digits.length >= 6 && digits.length === term.replace(/[\s+-]/g, "").length ? { name: "", phone: term } : { name: term, phone: "" });
  }

  async function save() {
    if (!adding || saving) return;
    if (!adding.name.trim()) return void toast.error("Enter the customer's name");
    if (!isValidMobile(adding.phone)) return void toast.error("Enter a valid 10-digit mobile number");
    setSaving(true);
    const result = await services.createCustomer({ name: adding.name.trim(), phone: adding.phone.trim() });
    setSaving(false);
    if (!result.ok) return void toast.error(result.error);
    toast.success(result.data.id ? "Customer added" : "Added to this bill only. Save the customer when you are back online.");
    onPick(result.data);
  }

  const canAdd = settings.canManageCustomers && query.trim().length >= 2 && !searching;

  if (adding) {
    return (
      <div className="grid gap-3 rounded-lg border p-3">
        <p className="text-sm font-medium">New customer</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="pos-new-name" required>
            <Input
              id="pos-new-name"
              autoFocus={!adding.name}
              value={adding.name}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </Field>
          <Field label="Mobile number" htmlFor="pos-new-phone" required>
            <Input
              id="pos-new-phone"
              type="tel"
              inputMode="tel"
              autoFocus={!!adding.name}
              value={adding.phone}
              onChange={(e) => setAdding({ ...adding, phone: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setAdding(null)} disabled={saving}>
            Back to search
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            Save customer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          autoFocus
          type="text"
          inputMode="search"
          autoComplete="off"
          aria-label="Find a customer by mobile number or name"
          placeholder="Mobile number or name"
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            const count = results?.length ?? 0;
            if (e.key === "ArrowDown" && count > 0) {
              e.preventDefault();
              setHighlight((highlight + 1) % count);
            } else if (e.key === "ArrowUp" && count > 0) {
              e.preventDefault();
              setHighlight((highlight - 1 + count) % count);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (results && results[highlight]) onPick(results[highlight]);
              else if (results && results.length === 0 && canAdd) startAdding();
            }
          }}
          className="h-10 pr-8 pl-8"
        />
        {searching ? (
          <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>

      {/* Fixed height, so the dialog does not jump while results load. */}
      <div className="mt-2 h-44 overflow-y-auto rounded-lg border" role="listbox" aria-label="Matching customers">
        {error ? (
          <p className="p-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : results === null ? (
          <p className="p-3 text-sm text-muted-foreground">
            {searching ? "Searching…" : "Type at least 2 characters of the mobile number or name."}
          </p>
        ) : (
          <>
            {results.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === highlight}
                onClick={() => onPick(c)}
                className={cn("flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-muted", i === highlight && "bg-muted")}
              >
                <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[c.phone ? formatMobile(c.phone) : null, c.gstin, c.state_code ? stateLabel(c.state_code) : null].filter(Boolean).join(" · ") || "No contact details"}
                  </span>
                </span>
              </button>
            ))}
            {results.length === 0 ? <p className="px-3 pt-3 text-sm text-muted-foreground">No customer found.</p> : null}
            {canAdd ? (
              <button
                type="button"
                onClick={startAdding}
                className="flex min-h-11 w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-medium text-primary hover:bg-muted"
              >
                <UserPlus className="size-4 shrink-0" aria-hidden />
                Add &quot;{query.trim()}&quot; as a new customer
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Customer, B2B details and place of supply for the bill (F4). Every change applies to the bill straight away. */
export function CustomerDialog({
  open,
  onOpenChange,
  cart,
  summary,
  settings,
  services,
  onCart,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartState;
  summary: CartSummary;
  settings: PosSettings;
  services: Pick<PosServices, "searchCustomers" | "createCustomer">;
  onCart: (cart: CartState) => void;
  onClosed: () => void;
}) {
  const customer = cart.customer;
  const isB2b = cart.supplyType === "b2b";
  const saved = !!customer?.id;
  const [lookup, setLookup] = useState(false);
  // The lookup stays until a saved customer is on the bill; "Change" brings it back.
  const showLookup = settings.canViewCustomers && (lookup || !saved);

  const gstin = customer?.gstin.trim() ? validateGstin(customer.gstin) : null;
  const phoneInvalid = !!customer?.phone.trim() && !isValidMobile(customer.phone);
  const patch = (fields: Partial<Omit<CartCustomer, "id">>) => onCart(patchCustomer(cart, fields));
  const override = cart.placeOfSupplyOverride;

  function pick(record: PosCustomer) {
    const { id, ...details } = customerFromRecord(record);
    // No id: typed in while offline. The details are printed on this bill, but there is no saved customer (so no credit).
    onCart(setCustomer(cart, id ? { id, ...details } : walkInCustomer(details)));
    setLookup(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          setLookup(false);
          onClosed();
        }}
      >
        <DialogHeader>
          <DialogTitle>Customer</DialogTitle>
          <DialogDescription>
            {isB2b ? "A B2B bill needs the customer's name and GSTIN." : "Optional for a walk-in sale. Needed to give credit or send the bill."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onOpenChange(false);
          }}
        >
          <SupplyTypeToggle value={cart.supplyType} onChange={(v) => onCart(setSupplyType(cart, v))} />

          {showLookup ? <CustomerLookup settings={settings} services={services} onPick={pick} /> : null}

          {saved && !showLookup ? (
            <div className="flex items-center gap-2.5 rounded-lg border bg-muted/40 p-2.5">
              <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{customer.name}</p>
                <p className="truncate text-xs text-muted-foreground">{customer.phone ? formatMobile(customer.phone) : "No mobile number"}</p>
              </div>
              {settings.canViewCustomers ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setLookup(true)}>
                  Change
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove customer from the bill" onClick={() => onCart(setCustomer(cart, null))}>
                <X />
              </Button>
            </div>
          ) : null}

          {!lookup ? (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                {saved ? "Details printed on this bill" : showLookup ? "Or type the details for this bill only" : "Details printed on this bill"}
              </legend>
              {!saved ? (
                <>
                  <Field label="Name" htmlFor="pos-cust-name" required={isB2b}>
                    <Input
                      id="pos-cust-name"
                      autoFocus={!settings.canViewCustomers}
                      value={customer?.name ?? ""}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Mobile number" htmlFor="pos-cust-phone" error={phoneInvalid ? "Enter a valid 10-digit mobile number" : null}>
                    <Input
                      id="pos-cust-phone"
                      type="tel"
                      inputMode="tel"
                      value={customer?.phone ?? ""}
                      onChange={(e) => patch({ phone: e.target.value })}
                    />
                  </Field>
                </>
              ) : null}
              <Field
                label="GSTIN"
                htmlFor="pos-cust-gstin"
                required={isB2b}
                error={gstin && !gstin.valid ? gstin.message : null}
                hint={gstin?.valid ? `Valid. Registered in ${stateLabel(gstin.stateCode)}` : isB2b ? "15 characters, e.g. 27AAPFU0939F1ZV" : undefined}
              >
                <Input
                  id="pos-cust-gstin"
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={15}
                  value={customer?.gstin ?? ""}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase().replace(/\s/g, "");
                    const parsed = validateGstin(value);
                    patch(parsed.valid && parsed.stateCode ? { gstin: value, state_code: parsed.stateCode } : { gstin: value });
                  }}
                  className="uppercase"
                />
              </Field>
              <Field label="State" htmlFor="pos-cust-state" hint={gstin?.valid ? "Taken from the GSTIN" : undefined}>
                <StateSelect
                  id="pos-cust-state"
                  disabled={!!gstin?.valid}
                  value={customer?.state_code ?? ""}
                  onChange={(e) => patch({ state_code: e.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor="pos-cust-email">
                <Input id="pos-cust-email" type="email" inputMode="email" value={customer?.email ?? ""} onChange={(e) => patch({ email: e.target.value })} />
              </Field>
              <Field label="PIN code" htmlFor="pos-cust-pin">
                <Input
                  id="pos-cust-pin"
                  inputMode="numeric"
                  maxLength={6}
                  value={customer?.pincode ?? ""}
                  onChange={(e) => patch({ pincode: e.target.value.replace(/\D/g, "") })}
                />
              </Field>
              <Field label="Address" htmlFor="pos-cust-address" className="sm:col-span-2">
                <Input id="pos-cust-address" value={customer?.address ?? ""} onChange={(e) => patch({ address: e.target.value })} />
              </Field>
            </fieldset>
          ) : null}

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Place of supply</legend>
            <Field label="Ship to another state" htmlFor="pos-delivery-state" hint="Only when the goods are sent to an address in a different state.">
              <StateSelect
                id="pos-delivery-state"
                variant="supply"
                placeholder="Not shipped (handed over at the shop)"
                value={cart.deliveryStateCode ?? ""}
                onChange={(e) => onCart(setDeliveryState(cart, e.target.value || null))}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={!!override}
                onChange={(e) =>
                  onCart(setPlaceOfSupplyOverride(cart, e.target.checked ? { stateCode: summary.placeOfSupply.stateCode, reason: "" } : null))
                }
              />
              Change the place of supply for this bill
            </label>
            {override ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Place of supply" htmlFor="pos-override-state" required>
                  <StateSelect
                    id="pos-override-state"
                    variant="supply"
                    value={override.stateCode}
                    onChange={(e) => e.target.value && onCart(setPlaceOfSupplyOverride(cart, { ...override, stateCode: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Reason"
                  htmlFor="pos-override-reason"
                  required
                  error={override.reason.trim().length < 3 ? "A reason is required. It is saved in the audit log." : null}
                >
                  <Input
                    id="pos-override-reason"
                    maxLength={200}
                    value={override.reason}
                    onChange={(e) => onCart(setPlaceOfSupplyOverride(cart, { ...override, reason: e.target.value }))}
                  />
                </Field>
              </div>
            ) : null}
            <p className="text-sm" aria-live="polite">
              Place of supply: <span className="font-medium">{summary.placeOfSupply.label}</span>
              {summary.chargeTax ? (
                <span className="text-muted-foreground"> · {summary.interState ? "IGST applies (another state)" : "CGST + SGST apply (same state)"}</span>
              ) : null}
            </p>
          </fieldset>

          <DialogFooter>
            {customer && !saved ? (
              <Button type="button" variant="outline" onClick={() => onCart(setCustomer(cart, null))}>
                Clear details
              </Button>
            ) : null}
            <Button type="submit">Done</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
