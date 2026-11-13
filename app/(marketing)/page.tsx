import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  MapPin,
  ScanLine,
  ShoppingBag,
  Star,
  WifiOff,
} from "lucide-react";
import { TAGLINE } from "@/components/brand";
import { JsonLd } from "@/components/marketing/json-ld";
import {
  BillingMock,
  DashboardMock,
  OfflineChip,
  PurchaseMock,
  RolesMock,
  ShipmentMock,
  StockMock,
} from "@/components/marketing/mocks";
import { Receipt } from "@/components/marketing/receipt";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/components/marketing/site";
import { absoluteUrl, env } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    locale: "en_IN",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

const CONTAINER = "mx-auto w-full max-w-6xl px-4 sm:px-6";
const CTA_PRIMARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";
const CTA_SECONDARY =
  "inline-flex h-12 items-center justify-center gap-2 rounded-xl border px-6 text-base font-semibold transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** A highlighter stroke in saffron behind a few words. */
function Marker({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-[linear-gradient(transparent_60%,var(--saffron)_60%,var(--saffron)_92%,transparent_92%)] whitespace-nowrap">
      {children}
    </span>
  );
}

function Eyebrow({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "light" }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.18em] uppercase",
        tone === "light" ? "text-white/80" : "text-brand",
      )}
    >
      <span aria-hidden className="h-0.5 w-6 bg-saffron" />
      {children}
    </p>
  );
}

function Bullets({ items, tone = "dark" }: { items: string[]; tone?: "dark" | "light" }) {
  return (
    <ul className={cn("mt-6 space-y-3 text-[15px]", tone === "light" ? "text-white/90" : "text-foreground/80")}>
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <Check className={cn("mt-1 size-4 shrink-0", tone === "light" ? "text-saffron" : "text-brand")} strokeWidth={3} aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ Hero */

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden">
      <div className={cn(CONTAINER, "grid items-center gap-12 pt-10 pb-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-10 lg:pt-16 lg:pb-24")}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
            <span aria-hidden className="size-1.5 rounded-full bg-saffron" />
            Shop OS for Indian retailers. Free early access.
          </p>
          <h1 id="hero-title" className="mt-5 text-4xl leading-[1.05] font-black tracking-tight sm:text-6xl lg:text-7xl">
            Billing ho ya stock, sab <Marker>ekdum sorted.</Marker>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            EkDum runs your shop counter and your back office from one panel: GST billing and POS, inventory, purchases,
            staff roles, digital receipts and courier dispatch. It keeps billing even when the internet does not.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className={CTA_PRIMARY}>
              Start free <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/#how-it-works" className={CTA_SECONDARY}>
              See how it works
            </Link>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {["Tax invoice, bill of supply, cash memo", "58mm, 80mm and A4 printing", "Data hosted in India"].map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <Check className="size-4 text-brand" strokeWidth={3} aria-hidden /> {item}
              </li>
            ))}
          </ul>
        </div>

        {/* The counter: a printer slot with a freshly printed bill */}
        <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
          <div
            className="relative rounded-[2rem] bg-brand px-4 pb-12 sm:px-8"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.14) 1px, transparent 1.5px)",
              backgroundSize: "18px 18px",
            }}
          >
            <div aria-hidden className="mx-auto h-4 w-[19rem] max-w-full rounded-b-2xl bg-neutral-950/60 shadow-inner" />
            <Receipt className="mx-auto -mt-1 w-[17rem] max-w-full motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in motion-safe:slide-in-from-top-6" />
            <OfflineChip className="absolute bottom-4 left-3 -rotate-2 sm:left-5" />
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Sample 80mm thermal bill. Shop details are illustrative.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------ Problem → solution */

const SWAPS = [
  {
    before: "Billing software stuck on one PC at the counter",
    after: "Bill from any PC, tablet or phone, right in the browser",
  },
  {
    before: "Stock written in a register that never matches the shelf",
    after: "Every sale and purchase updates stock, with a ledger that shows why",
  },
  {
    before: "Purchase bills piled up in a drawer",
    after: "Purchase bills entered once, with the photo attached",
  },
  {
    before: "Courier slips lost somewhere in WhatsApp chats",
    after: "A dispatch log with receipt photo and tracking link",
  },
  {
    before: "The day's sale added up on a calculator at night",
    after: "An owner dashboard that already has the total",
  },
];

function ProblemSolution() {
  return (
    <section aria-labelledby="problem-title" className="border-y bg-muted/40 py-16 lg:py-24">
      <div className={CONTAINER}>
        <div className="max-w-2xl">
          <Eyebrow>Pehle aur ab</Eyebrow>
          <h2 id="problem-title" className="mt-3 text-3xl leading-tight font-black tracking-tight sm:text-5xl">
            Paanch jagah ka kaam, ek panel mein.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Most shops run on a billing PC, a stock register, a drawer of purchase bills and a phone full of courier
            photos. Nothing talks to anything else. EkDum puts them in one place.
          </p>
        </div>

        <ul className="mt-10 space-y-3">
          {SWAPS.map((swap, index) => (
            <li
              key={swap.before}
              className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch"
            >
              {/* Ruled ledger paper for the old way */}
              <p
                className="relative py-4 pr-4 pl-10 text-[15px] text-muted-foreground italic"
                style={{
                  backgroundImage: "repeating-linear-gradient(transparent 0 27px, rgba(0,0,0,0.06) 27px 28px)",
                }}
              >
                <span aria-hidden className="absolute inset-y-0 left-6 w-px bg-destructive/40" />
                <span className="sr-only">Before: </span>
                {swap.before}
              </p>
              <span aria-hidden className="flex items-center justify-center border-y bg-saffron px-3 py-1 text-neutral-950 md:border-x md:border-y-0">
                <ArrowDown className="size-4 md:hidden" />
                <ArrowRight className="hidden size-4 md:block" />
              </span>
              <p className="flex items-center gap-3 p-4 text-[15px] font-medium">
                <span aria-hidden className="font-mono text-xs text-brand">
                  0{index + 1}
                </span>
                <span className="sr-only">With EkDum: </span>
                {swap.after}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- Features */

function FeatureText({
  id,
  eyebrow,
  title,
  body,
  bullets,
  tone = "dark",
}: {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  tone?: "dark" | "light";
}) {
  return (
    <div>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h3 id={id} className="mt-3 text-2xl leading-tight font-black tracking-tight sm:text-4xl">
        {title}
      </h3>
      <p className={cn("mt-4 text-base leading-relaxed", tone === "light" ? "text-white/80" : "text-muted-foreground")}>{body}</p>
      <Bullets items={bullets} tone={tone} />
    </div>
  );
}

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-20 pt-16 lg:pt-24">
      <div className={CONTAINER}>
        <div className="max-w-2xl">
          <Eyebrow>What is inside</Eyebrow>
          <h2 id="features-title" className="mt-3 text-3xl leading-tight font-black tracking-tight sm:text-5xl">
            Counter se courier tak, sab ek jagah.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Six parts of the shop, built to work together. Everything below is in the product today.
          </p>
        </div>
      </div>

      {/* Billing: the main act, on a full indigo band */}
      <article aria-labelledby="feature-billing" className="mt-12 bg-brand py-14 text-white lg:py-20">
        <div className={cn(CONTAINER, "grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16")}>
          <FeatureText
            id="feature-billing"
            tone="light"
            eyebrow="Billing and POS"
            title="GST bill, seconds mein. Sahi tax, har baar."
            body="A fast billing screen made for the counter, with a barcode scanner or without. EkDum works out the tax for each bill, so your cashier only has to pick the items."
            bullets={[
              "Tax invoice, bill of supply or cash memo, chosen by your GST scheme",
              "CGST + SGST or IGST worked out automatically from the place of supply",
              "B2B bills with the customer's GSTIN, and quick B2C walk-in bills",
              "Split payments across cash, UPI and card, and discounts with a limit for each role",
              "58mm or 80mm thermal print, A4 PDF, and a UPI QR on the bill",
              "Receipts by email or WhatsApp, plus a public invoice link (WhatsApp needs your own WhatsApp Business setup)",
              "Works offline at the counter and syncs the bills when the internet is back",
            ]}
          />
          <BillingMock />
        </div>
      </article>

      <div className={cn(CONTAINER, "space-y-16 py-16 lg:space-y-28 lg:py-24")}>
        {/* Inventory: mock first on desktop */}
        <article aria-labelledby="feature-inventory" className="grid items-center gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-20">
          <div className="relative order-last lg:order-first">
            <div aria-hidden className="absolute -inset-3 -rotate-2 rounded-3xl bg-saffron/20" />
            <StockMock className="relative" />
          </div>
          <FeatureText
            id="feature-inventory"
            eyebrow="Inventory"
            title="Stock ka hisaab, bina register ke."
            body="Every sale, purchase and return moves stock on its own. When the count on the shelf is different, adjust it with a reason and the ledger keeps the trail."
            bullets={[
              "A stock ledger for every product, showing each movement and the running balance",
              "Adjustments for damage, loss or a recount, with a reason",
              "Low-stock alerts before the shelf goes empty",
              "Separate stock for each outlet if you run more than one",
            ]}
          />
        </article>

        {/* Purchases: text first, mock offset to the right */}
        <article aria-labelledby="feature-purchases" className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-20">
          <FeatureText
            id="feature-purchases"
            eyebrow="Purchases"
            title="Maal aaya? Bill daalo, stock apne aap update."
            body="Enter the vendor's bill once and attach a photo or PDF of the paper copy. Stock goes up when you save it, and the bill is there the day your accountant asks for it."
            bullets={[
              "Purchase bills with a photo or PDF attachment",
              "Stock updated from the purchase, so nothing is entered twice",
              "Vendors and their bills in one searchable list",
            ]}
          />
          <div className="relative">
            <div aria-hidden className="absolute -inset-3 rotate-2 rounded-3xl bg-brand/10" />
            <PurchaseMock className="relative" />
          </div>
        </article>

        {/* Staff and dispatch: an uneven pair */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <article aria-labelledby="feature-staff" className="rounded-3xl border bg-muted/40 p-5 sm:p-8">
            <FeatureText
              id="feature-staff"
              eyebrow="Staff roles"
              title="Har staff ko utna hi access, jitna kaam."
              body="Give each person their own login. Owner, manager, cashier and dispatch roles come ready, and you can change what each one is allowed to do."
              bullets={[
                "Permissions for billing, stock, purchases, reports and settings",
                "A discount limit for each role, so nobody gives away the margin",
                "Cost prices hidden from staff who do not need them",
              ]}
            />
            <RolesMock className="mt-8" />
          </article>

          <article aria-labelledby="feature-dispatch" className="rounded-3xl border bg-muted/40 p-5 sm:p-8">
            <FeatureText
              id="feature-dispatch"
              eyebrow="Dispatch"
              title="Parcel gaya ya nahi? Photo ke saath proof."
              body="Log every courier handover from a phone: the courier, the tracking number and a photo of the receipt."
              bullets={[
                "Courier log with receipt photo as proof",
                "Tracking link and status for every shipment",
                "Pending and stuck parcels are easy to spot",
              ]}
            />
            <ShipmentMock className="mt-8" />
          </article>
        </div>
      </div>

      {/* Dashboard: closes the section on a dark panel */}
      <div className={CONTAINER}>
        <article
          aria-labelledby="feature-dashboard"
          className="grid items-center gap-8 rounded-3xl bg-neutral-950 p-5 text-white sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-14"
        >
          <FeatureText
            id="feature-dashboard"
            tone="light"
            eyebrow="Owner dashboard"
            title="Raat ko calculator nahi, bas dashboard."
            body="Open your phone at closing time and the day is already added up, for one outlet or all of them."
            bullets={[
              "Sales, bill count, tax collected and the cash, UPI and card split",
              "Top products, sales by staff member and low-stock items",
              "Reports you can download as CSV for your accountant",
            ]}
          />
          <DashboardMock />
        </article>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Coming soon */

const COMING_SOON = [
  {
    icon: Star,
    title: "Google Business Profile",
    body: "See and reply to your Google reviews and publish posts, from the same panel.",
  },
  {
    icon: ShoppingBag,
    title: "Shopify sync",
    body: "Keep products, stock and online orders in step with your Shopify store.",
  },
  {
    icon: ScanLine,
    title: "AI bill scanning",
    body: "Take a photo of a purchase bill and get a draft entry to check, instead of typing it.",
  },
];

function ComingSoon() {
  return (
    <section aria-labelledby="soon-title" className="py-16 lg:py-24">
      <div className={cn(CONTAINER, "grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16")}>
        <div>
          <Eyebrow>Coming soon</Eyebrow>
          <h2 id="soon-title" className="mt-3 text-3xl leading-tight font-black tracking-tight sm:text-4xl">
            Aage kya aa raha hai.
          </h2>
          <p className="mt-4 text-muted-foreground">
            These are not available yet. We are listing them so you know where EkDum is headed, and we are not promising
            dates.
          </p>
        </div>
        <ul className="divide-y divide-dashed rounded-3xl border border-dashed">
          {COMING_SOON.map((item) => (
            <li key={item.title} className="flex gap-4 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dashed text-muted-foreground">
                <item.icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{item.title}</h3>
                  <span className="rounded-full bg-saffron/20 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
                    Coming soon
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- How it works */

const STEPS = [
  {
    title: "Sign up and set up your shop",
    body: "Add your business details, GST scheme, first outlet and how your invoices should look. A short wizard walks you through it.",
  },
  {
    title: "Add your products",
    body: "Type them in, or import your item list from a CSV file with HSN codes, GST rates and prices.",
  },
  {
    title: "Start billing",
    body: "Open the billing screen on your counter PC, tablet or phone and make the first bill. Print it or send it.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-y bg-muted/40 py-16 lg:py-24">
      <div className={CONTAINER}>
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-title" className="mt-3 text-3xl leading-tight font-black tracking-tight sm:text-5xl">
            Teen step, aur dukaan live.
          </h2>
        </div>
        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative md:pr-8">
              <div className="flex items-center gap-4">
                <span aria-hidden className="font-mono text-6xl leading-none font-black text-brand sm:text-7xl">
                  {index + 1}
                </span>
                <span aria-hidden className="h-0.5 flex-1 bg-[repeating-linear-gradient(90deg,var(--saffron)_0_8px,transparent_8px_14px)]" />
              </div>
              <h3 className="mt-4 text-xl font-bold tracking-tight">
                <span className="sr-only">Step {index + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-2 text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10">
          <Link href="/signup" className={CTA_PRIMARY}>
            Set up my shop <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Pricing */

function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 py-16 lg:py-24">
      <div className={cn(CONTAINER, "grid items-center gap-10 lg:grid-cols-2 lg:gap-16")}>
        <div>
          <Eyebrow>Pricing</Eyebrow>
          <h2 id="pricing-title" className="mt-3 text-3xl leading-tight font-black tracking-tight sm:text-5xl">
            Abhi ke liye, free.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            EkDum is in beta, and early access is free while it is. We have not decided pricing yet, so we are not going
            to show you made-up plans. Paid plans will be announced later.
          </p>
          <div className="mt-8">
            <Link href="/signup" className={CTA_PRIMARY}>
              Get early access <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>

        {/* A shop rate card */}
        <div className="rotate-1 rounded-2xl bg-neutral-950 p-2 shadow-xl">
          <div className="rounded-xl border-2 border-dashed border-white/25 p-5 font-mono text-white sm:p-8">
            <p className="text-center text-xs font-semibold tracking-[0.3em] text-saffron uppercase">Rate card</p>
            <dl className="mt-6 space-y-5 text-sm sm:text-base">
              <div className="flex items-baseline gap-2">
                <dt className="shrink-0">Early access (beta)</dt>
                <span aria-hidden className="min-w-4 flex-1 border-b-2 border-dotted border-white/30" />
                <dd className="shrink-0 text-xl font-black text-saffron sm:text-2xl">FREE</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="shrink-0">Paid plans</dt>
                <span aria-hidden className="min-w-4 flex-1 border-b-2 border-dotted border-white/30" />
                <dd className="shrink-0 text-white/70">To be announced</dd>
              </div>
            </dl>
            <p className="mt-6 border-t border-dashed border-white/25 pt-4 text-xs text-white/60">
              No card needed to sign up. Pricing is not decided yet.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- FAQ */

const FAQS = [
  {
    q: "Is EkDum GST compliant?",
    a: "EkDum creates a tax invoice, bill of supply or cash memo depending on the GST scheme you set for your business, with HSN codes and GST rates on each item. It splits tax into CGST + SGST or IGST from the place of supply, and handles both B2B and B2C bills. It does not file returns, and it does not hold any certification. You stay responsible for your GST details being correct, so please check your setup with your CA.",
  },
  {
    q: "Does it work without internet?",
    a: "The billing counter does. If the connection drops, you can keep making and printing bills. They are saved on that device and sync when you are back online. You need internet the first time you open the app on a device, and for other screens such as purchases, reports and settings.",
  },
  {
    q: "Which printers does it support?",
    a: "58mm and 80mm thermal receipt printers and normal A4 printers. Printing goes through your browser's print dialog, so the printer has to be installed on that device and show up there. You can also download the invoice as an A4 PDF.",
  },
  {
    q: "Can my staff have limited access?",
    a: "Yes. Each staff member gets their own login with a role: owner, manager, cashier or dispatch. You can change what each role is allowed to do, limit how much discount it can give, and hide cost prices from it.",
  },
  {
    q: "Is my data safe?",
    a: "Your data is hosted in India (Mumbai region). Each business's data is kept separate with access rules enforced in the database itself, and private files such as purchase bill photos are only opened through links that expire. We have not been through a third-party security audit or certification yet, and we would rather tell you that than hint otherwise.",
  },
  {
    q: "Can I move from my current billing software?",
    a: "You can bring your product list across with a CSV import (names, HSN codes, GST rates and prices), which is usually the biggest job. Old invoices are not imported, so keep your previous software's records for past periods.",
  },
  {
    q: "Does it work on a phone or tablet?",
    a: "Yes. EkDum runs in the browser on a phone, tablet or PC, and you can add it to the home screen so it opens like an app. Billing is most comfortable on a tablet or PC; dispatch and the dashboard are made for a phone.",
  },
  {
    q: "What about e-invoicing and e-way bills?",
    a: "Not yet. EkDum does not generate e-invoices (IRN) or e-way bills today. If your business is required to issue e-invoices, you will still need your current method for that.",
  },
];

function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t bg-muted/40 py-16 lg:py-24">
      <div className={cn(CONTAINER, "grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-16")}>
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 id="faq-title" className="mt-3 text-3xl leading-tight font-black tracking-tight sm:text-4xl">
            Seedhe sawaal, seedhe jawaab.
          </h2>
          <p className="mt-4 text-muted-foreground">Honest answers, including the things EkDum does not do yet.</p>
        </div>
        <div className="divide-y rounded-2xl border bg-card">
          {FAQS.map((faq) => (
            <details key={faq.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-5 text-left font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                {faq.q}
                <ChevronDown
                  className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <p className="px-5 pb-5 leading-relaxed text-muted-foreground">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- Final CTA */

function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="bg-brand text-white">
      <div className={cn(CONTAINER, "flex flex-col items-start gap-8 py-16 lg:flex-row lg:items-end lg:justify-between lg:py-24")}>
        <div>
          <h2 id="cta-title" className="text-4xl leading-[1.05] font-black tracking-tight sm:text-6xl">
            Poora dhandha,
            <br />
            <span className="text-saffron">ekdum sorted.</span>
          </h2>
          <p className="mt-5 max-w-xl text-lg text-white/80">
            Set up your shop today and make your first GST bill. Early access is free while EkDum is in beta.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/80">
            <li className="flex items-center gap-1.5">
              <WifiOff className="size-4 text-saffron" aria-hidden /> Bills offline, syncs later
            </li>
            <li className="flex items-center gap-1.5">
              <MapPin className="size-4 text-saffron" aria-hidden /> Data hosted in India
            </li>
          </ul>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-base font-semibold text-brand transition-colors hover:bg-white/90 focus-visible:ring-3 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            Start free <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/40 px-6 text-base font-semibold transition-colors hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- Page */

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": absoluteUrl("/#organization"),
  name: SITE_NAME,
  url: env.appUrl,
  logo: absoluteUrl("/icons/icon-512.png"),
  slogan: TAGLINE,
  parentOrganization: { "@type": "Organization", name: "NineAgents" },
};

const softwareLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  url: env.appUrl,
  description: SITE_DESCRIPTION,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  inLanguage: "en-IN",
  publisher: { "@id": absoluteUrl("/#organization") },
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "INR",
    description: "Free early access while EkDum is in beta. Paid plans have not been announced.",
  },
  featureList: [
    "GST billing and POS",
    "Thermal and A4 invoice printing",
    "Inventory and stock ledger",
    "Purchase bills with attachments",
    "Staff roles and permissions",
    "Courier dispatch log",
    "Owner dashboard and CSV reports",
  ],
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={organizationLd} />
      <JsonLd data={softwareLd} />
      <Hero />
      <ProblemSolution />
      <Features />
      <ComingSoon />
      <HowItWorks />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
