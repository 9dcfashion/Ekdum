"use client";

import { AlertCircle, MapPin, Percent, UserRound } from "lucide-react";
import { DOCUMENT_TITLES, formatRate, formatMobile } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { isDiscountSet, type CartSummary } from "@/lib/pos/cart";
import type { CartIssue, CartState, PosContext } from "@/lib/pos/types";
import { cn } from "@/lib/utils";
import { Kbd } from "./shortcut-legend";

function Row({ label, value, muted, hidden }: { label: React.ReactNode; value: string; muted?: boolean; hidden?: boolean }) {
  return (
    <div className={cn("flex h-6 items-center justify-between gap-3 text-sm", muted && "text-muted-foreground", hidden && "invisible")} aria-hidden={hidden}>
      <span>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

/** B2C / B2B switch. */
export function SupplyTypeToggle({ value, onChange }: { value: "b2c" | "b2b"; onChange: (value: "b2c" | "b2b") => void }) {
  const options = [
    { value: "b2c" as const, label: "B2C", hint: "Walk-in or retail customer" },
    { value: "b2b" as const, label: "B2B", hint: "Business customer with GSTIN" },
  ];
  return (
    <div role="radiogroup" aria-label="Type of sale" className="inline-flex h-8 shrink-0 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Customer, place of supply and the live totals with the tax breakdown. Every row has a fixed height. */
export function BillSummary({
  cart,
  summary,
  ctx,
  issues,
  onOpenCustomer,
  onSupplyType,
  onOpenDiscount,
}: {
  cart: CartState;
  summary: CartSummary;
  ctx: PosContext;
  issues: CartIssue[];
  onOpenCustomer: () => void;
  onSupplyType: (value: "b2c" | "b2b") => void;
  onOpenDiscount: () => void;
}) {
  const { totals } = summary;
  const customer = cart.customer;
  const customerIssue = issues.find((i) => i.code === "b2b_customer" || i.code === "override_reason");
  const discountIssue = issues.find((i) => i.code === "discount_over_limit" || i.code === "discount_not_allowed");
  const taxKind = summary.interState ? "IGST" : "CGST + SGST";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Customer */}
      <section aria-label="Customer" className="shrink-0 rounded-xl border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <SupplyTypeToggle value={cart.supplyType} onChange={onSupplyType} />
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{DOCUMENT_TITLES[summary.documentType]}</span>
        </div>
        <button
          type="button"
          onClick={onOpenCustomer}
          className="mt-2 flex h-12 w-full items-center gap-2.5 rounded-lg border border-dashed px-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {customer ? customer.name || formatMobile(customer.phone) || customer.phone || customer.email || "Customer" : "Walk-in customer"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {customer
                ? [customer.name ? formatMobile(customer.phone) || customer.phone : "", customer.gstin].filter(Boolean).join(" · ") ||
                  (customer.id ? "Saved customer" : "Details for this bill only")
                : "Add a customer"}
            </span>
          </span>
          <Kbd>F4</Kbd>
        </button>
        <p className="mt-2 flex h-5 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            Place of supply: <span className="font-medium text-foreground">{summary.placeOfSupply.label}</span>
            {summary.chargeTax ? ` · ${taxKind}` : ""}
          </span>
        </p>
        <p className={cn("flex h-5 items-center gap-1.5 truncate text-xs text-destructive", !customerIssue && "invisible")} role={customerIssue ? "alert" : undefined}>
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{customerIssue?.message ?? "No issues"}</span>
        </p>
      </section>

      {/* Totals */}
      <section aria-label="Bill totals" className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border bg-background p-3">
        <Row label={`Subtotal (${summary.itemCount} ${summary.itemCount === 1 ? "item" : "items"})`} value={formatINR(totals.subtotalPaise)} />
        <div className="flex h-6 items-center justify-between gap-3 text-sm">
          {ctx.canDiscount ? (
            <button
              type="button"
              onClick={onOpenDiscount}
              className="inline-flex items-center gap-1.5 rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Percent className="size-3.5" aria-hidden />
              {isDiscountSet(cart.billDiscount) ? "Discount" : "Add bill discount"}
              <Kbd>F8</Kbd>
            </button>
          ) : (
            <span className="text-muted-foreground">Discount</span>
          )}
          <span className={cn("tabular", totals.discountPaise > 0 && "text-emerald-700")}>
            {totals.discountPaise > 0 ? `− ${formatINR(totals.discountPaise)} (${summary.discountPercent}%)` : formatINR(0)}
          </span>
        </div>
        <p className={cn("h-4 truncate text-xs", discountIssue ? "text-destructive" : "text-muted-foreground", !ctx.canDiscount && "invisible")} role={discountIssue ? "alert" : undefined}>
          {discountIssue?.message ?? `Your discount limit is ${ctx.maxDiscountPercent}% of the bill`}
        </p>

        {summary.chargeTax ? (
          <>
            <Row label="Taxable value" value={formatINR(totals.taxablePaise)} muted />
            {summary.interState ? (
              <>
                <Row label="IGST" value={formatINR(totals.igstPaise)} muted />
                <Row label="SGST" value="" hidden />
              </>
            ) : (
              <>
                <Row label="CGST" value={formatINR(totals.cgstPaise)} muted />
                <Row label="SGST" value={formatINR(totals.sgstPaise)} muted />
              </>
            )}
            <Row label="Cess" value={formatINR(totals.cessPaise)} muted hidden={totals.cessPaise === 0} />
          </>
        ) : (
          <p className="flex h-6 items-center text-xs text-muted-foreground">
            {ctx.gstScheme === "composition" ? "Composition scheme: no tax is charged on the bill." : "No GST is charged on this bill."}
          </p>
        )}
        <Row label="Round off" value={formatINR(totals.roundOffPaise)} muted hidden={!ctx.roundOff} />

        <div className="mt-2 flex items-end justify-between gap-3 border-t pt-2">
          <span className="text-sm font-medium">Total</span>
          <span className="tabular text-3xl leading-none font-semibold tracking-tight" aria-live="polite">
            {formatINR(totals.totalPaise)}
          </span>
        </div>

        {summary.chargeTax && summary.rateSummary.length > 0 ? (
          <table className="mt-3 w-full text-xs text-muted-foreground">
            <caption className="sr-only">Tax by rate</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1 font-medium">GST rate</th>
                <th scope="col" className="py-1 text-right font-medium">Taxable</th>
                <th scope="col" className="py-1 text-right font-medium">{summary.interState ? "IGST" : "CGST + SGST"}</th>
                <th scope="col" className="py-1 text-right font-medium">Cess</th>
              </tr>
            </thead>
            <tbody>
              {summary.rateSummary.map((r) => (
                <tr key={r.gstRate}>
                  <td className="py-0.5">{formatRate(r.gstRate)}</td>
                  <td className="tabular py-0.5 text-right">{formatINR(r.taxablePaise, { symbol: false })}</td>
                  <td className="tabular py-0.5 text-right">{formatINR(r.cgstPaise + r.sgstPaise + r.igstPaise, { symbol: false })}</td>
                  <td className="tabular py-0.5 text-right">{formatINR(r.cessPaise, { symbol: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </div>
  );
}
