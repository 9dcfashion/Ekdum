"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import type { Business, GstRate, Outlet, Role, Unit } from "@/lib/types/db";
import { cn } from "@/lib/utils";
import { BrandingStep } from "./steps/branding";
import { BusinessStep } from "./steps/business";
import { InviteStep } from "./steps/invite";
import { InvoiceStep } from "./steps/invoice";
import { OutletStep } from "./steps/outlet";
import { PaymentStep } from "./steps/payment";
import { ProductsStep } from "./steps/products";

export interface WizardData {
  createNew: boolean;
  step: number;
  /** The furthest step reached so far; earlier steps can be revisited. */
  savedStep: number;
  userEmail: string;
  business: Business | null;
  logoUrl: string | null;
  outlet: Outlet | null;
  series: { prefix: string; nextNumber: number } | null;
  roles: Pick<Role, "id" | "name" | "system_key">[];
  gstRates: GstRate[];
  units: Unit[];
  invites: Array<{ id: string; email: string }>;
  products: Array<{ id: string; name: string }>;
}

const STEPS = [
  { title: "Business", blurb: "Your shop's legal and GST details" },
  { title: "Branding", blurb: "Logo and colour for your bills" },
  { title: "Payments", blurb: "Bank and UPI shown on invoices" },
  { title: "Outlet", blurb: "Where you bill from" },
  { title: "Invoices", blurb: "Numbering and print format" },
  { title: "Staff", blurb: "Invite your team (optional)" },
  { title: "Products", blurb: "Add what you sell (optional)" },
];

export function OnboardingWizard({ data }: { data: WizardData }) {
  const current = STEPS[data.step - 1];

  return (
    <div>
      <ol className="mb-6 flex items-center gap-1 overflow-x-auto pb-1 sm:gap-2" aria-label="Setup progress">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const done = n < data.savedStep;
          const active = n === data.step;
          const reachable = n <= data.savedStep && !data.createNew;
          const dot = (
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs whitespace-nowrap transition-colors sm:px-2.5",
                active && "border-primary bg-primary text-primary-foreground",
                !active && done && "border-primary/30 bg-primary/5 text-primary",
                !active && !done && "bg-background text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done && !active ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <span className="tabular font-semibold">{n}</span>
              )}
              <span className={cn(active ? "inline" : "hidden md:inline")}>{s.title}</span>
            </span>
          );
          return (
            <li key={s.title} className="shrink-0">
              {reachable && !active ? (
                <Link href={`/onboarding?step=${n}`} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {dot}
                </Link>
              ) : (
                dot
              )}
            </li>
          );
        })}
      </ol>

      <div className="rounded-2xl border bg-background p-5 shadow-xs sm:p-7">
        <p className="text-xs font-medium text-muted-foreground">
          Step {data.step} of {STEPS.length}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{current.title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{current.blurb}</p>

        {data.step === 1 ? <BusinessStep data={data} /> : null}
        {data.step === 2 ? <BrandingStep data={data} /> : null}
        {data.step === 3 ? <PaymentStep data={data} /> : null}
        {data.step === 4 ? <OutletStep data={data} /> : null}
        {data.step === 5 ? <InvoiceStep data={data} /> : null}
        {data.step === 6 ? <InviteStep data={data} /> : null}
        {data.step === 7 ? <ProductsStep data={data} /> : null}
      </div>
    </div>
  );
}
