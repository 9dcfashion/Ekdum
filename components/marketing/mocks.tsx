import {
  AlertTriangle,
  Camera,
  Check,
  FileText,
  Mail,
  MessageCircle,
  Minus,
  PackageCheck,
  Paperclip,
  Printer,
  Truck,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small, hand-built UI fragments used as illustrations on the landing page.
 * Each one is exposed to assistive tech as a single labelled image; all the
 * names and numbers in them are sample data.
 */
function Mock({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("rounded-2xl border bg-card p-4 text-sm text-card-foreground shadow-sm select-none sm:p-5", className)}
    >
      {children}
    </div>
  );
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", className)}>
      {children}
    </span>
  );
}

export function BillingMock({ className }: { className?: string }) {
  return (
    <Mock
      className={className}
      label="Illustration of a B2B bill: tax invoice selected, customer in another state so IGST applies, total 11,800 rupees split between cash and UPI, with print and share options."
    >
      <div className="flex flex-wrap gap-1.5">
        <Chip className="bg-brand text-white">Tax invoice</Chip>
        <Chip className="bg-muted text-muted-foreground">Bill of supply</Chip>
        <Chip className="bg-muted text-muted-foreground">Cash memo</Chip>
      </div>

      <div className="mt-4 rounded-xl border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">Mehta Traders</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">GSTIN 27ABCDE1234F1Z5</p>
          </div>
          <Chip className="shrink-0 bg-brand/10 text-brand">B2B</Chip>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Place of supply: Maharashtra. Other state, so <span className="font-semibold text-foreground">IGST</span>.
        </p>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Taxable value</dt>
          <dd className="tabular">₹10,000.00</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">IGST 18%</dt>
          <dd className="tabular">₹1,800.00</dd>
        </div>
        <div className="flex justify-between border-t pt-2 text-base font-bold">
          <dt>Total</dt>
          <dd className="tabular">₹11,800.00</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-1.5">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Split payment</p>
        <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
          <span>Cash</span>
          <span className="tabular font-medium">₹1,800.00</span>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
          <span>UPI</span>
          <span className="tabular font-medium">₹10,000.00</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
        <Chip className="border">
          <Printer className="size-3" aria-hidden /> 80mm
        </Chip>
        <Chip className="border">
          <FileText className="size-3" aria-hidden /> A4 PDF
        </Chip>
        <Chip className="border">
          <MessageCircle className="size-3" aria-hidden /> WhatsApp
        </Chip>
        <Chip className="border">
          <Mail className="size-3" aria-hidden /> Email
        </Chip>
      </div>
    </Mock>
  );
}

export function OfflineChip({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Illustration: counter is offline, 2 bills waiting to sync."
      className={cn(
        "inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-medium text-neutral-900 shadow-lg",
        className,
      )}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-saffron/20">
        <WifiOff className="size-3.5" aria-hidden />
      </span>
      Offline. 2 bills will sync.
    </div>
  );
}

const LEDGER = [
  { date: "10/11", what: "Purchase", change: "+24", balance: "27" },
  { date: "11/11", what: "Sale", change: "-2", balance: "25" },
  { date: "12/11", what: "Adjustment: damaged", change: "-1", balance: "24" },
];

export function StockMock({ className }: { className?: string }) {
  return (
    <Mock
      className={className}
      label="Illustration of a stock ledger for Basmati Rice 5kg showing a purchase, a sale and a damage adjustment with running balance, and a low-stock alert for Tea 500g."
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">Basmati Rice 5kg</p>
          <p className="text-xs text-muted-foreground">Stock ledger</p>
        </div>
        <p className="tabular text-2xl font-bold">
          24 <span className="text-xs font-normal text-muted-foreground">in stock</span>
        </p>
      </div>
      <div className="mt-3 divide-y rounded-xl border font-mono text-xs">
        {LEDGER.map((row) => (
          <div key={row.date} className="grid grid-cols-[2.75rem_minmax(0,1fr)_2rem_2rem] items-center gap-2 px-3 py-2">
            <span className="text-muted-foreground">{row.date}</span>
            <span className="truncate">{row.what}</span>
            <span className={cn("tabular text-right font-semibold", row.change.startsWith("+") ? "text-success" : "text-destructive")}>
              {row.change}
            </span>
            <span className="tabular text-right">{row.balance}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-saffron/15 px-3 py-2.5">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold">Tea 500g</span> is running low
        </p>
        <Chip className="shrink-0 bg-saffron text-neutral-950">3 left</Chip>
      </div>
    </Mock>
  );
}

export function PurchaseMock({ className }: { className?: string }) {
  return (
    <Mock
      className={className}
      label="Illustration of a purchase bill from a distributor with a photo of the paper bill attached, adding 24 units to stock."
    >
      <div className="flex gap-4">
        {/* A photographed paper bill, drawn in CSS */}
        <div className="relative w-20 shrink-0 rotate-[-4deg] rounded-sm bg-neutral-100 p-2 shadow-md ring-1 ring-black/5">
          <div className="h-1.5 w-10 rounded-full bg-neutral-400" />
          <div className="mt-2 space-y-1">
            <div className="h-1 rounded-full bg-neutral-300" />
            <div className="h-1 rounded-full bg-neutral-300" />
            <div className="h-1 w-3/4 rounded-full bg-neutral-300" />
            <div className="h-1 rounded-full bg-neutral-300" />
            <div className="h-1 w-1/2 rounded-full bg-neutral-300" />
          </div>
          <div className="mt-3 ml-auto h-1.5 w-6 rounded-full bg-neutral-500" />
          <span className="absolute -right-2 -bottom-2 flex size-6 items-center justify-center rounded-full bg-brand text-white">
            <Camera className="size-3.5" aria-hidden />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">Gupta Distributors</p>
          <p className="text-xs text-muted-foreground">Bill no. 884, 10/11/2026</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="size-3 shrink-0" aria-hidden /> <span className="truncate">bill-photo.jpg attached</span>
          </p>
        </div>
      </div>
      <div className="mt-4 divide-y rounded-xl border text-xs">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="truncate">Basmati Rice 5kg</span>
          <span className="tabular shrink-0 text-muted-foreground">24 x ₹540.00</span>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2 font-semibold">
          <span>Bill total (incl. GST)</span>
          <span className="tabular">₹13,608.00</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <Chip className="bg-success/15 text-success">
          <PackageCheck className="size-3" aria-hidden /> Stock +24
        </Chip>
        <span className="text-muted-foreground">added on save</span>
      </div>
    </Mock>
  );
}

const ROLES = ["Owner", "Manager", "Cashier", "Dispatch"];
const PERMISSIONS: Array<{ name: string; cells: Array<boolean | string> }> = [
  { name: "Make bills", cells: [true, true, true, false] },
  { name: "Max discount", cells: ["Any", "15%", "5%", false] },
  { name: "See cost", cells: [true, true, false, false] },
  { name: "Log dispatch", cells: [true, true, false, true] },
  { name: "Manage staff", cells: [true, false, false, false] },
];

export function RolesMock({ className }: { className?: string }) {
  return (
    <Mock
      className={className}
      label="Illustration of a permissions table: owner can do everything, manager most things, cashier can make bills with a 5 percent discount limit, dispatch staff can only log dispatches."
    >
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,2.75rem)] items-center gap-y-2 text-xs sm:grid-cols-[minmax(0,1fr)_repeat(4,3.75rem)]">
        <span />
        {ROLES.map((role) => (
          <span key={role} className="truncate text-center text-[10px] font-semibold text-muted-foreground sm:text-[11px]">
            {role}
          </span>
        ))}
        {PERMISSIONS.map((perm) => (
          <div key={perm.name} className="contents">
            <span className="truncate border-t pt-2 font-medium">{perm.name}</span>
            {perm.cells.map((cell, index) => (
              <span key={index} className="flex justify-center border-t pt-2">
                {cell === true ? (
                  <Check className="size-4 text-brand" aria-hidden />
                ) : cell === false ? (
                  <Minus className="size-4 text-muted-foreground/50" aria-hidden />
                ) : (
                  <span className="tabular font-semibold">{cell}</span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">Example setup. You decide who can do what.</p>
    </Mock>
  );
}

const TIMELINE = [
  { title: "Packed", meta: "12/11, 11:05 AM", done: true },
  { title: "Handed to courier", meta: "12/11, 04:30 PM. Receipt photo added", done: true },
  { title: "In transit", meta: "Tracking number and link saved", done: true },
  { title: "Delivered", meta: "Waiting", done: false },
];

export function ShipmentMock({ className }: { className?: string }) {
  return (
    <Mock
      className={className}
      label="Illustration of a shipment timeline: packed, handed to courier with a receipt photo, in transit with tracking number, delivery pending."
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">Order for Anita Verma, Udaipur</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">AWB 7741 2290 18</p>
        </div>
        <Chip className="shrink-0 bg-brand/10 text-brand">
          <Truck className="size-3" aria-hidden /> In transit
        </Chip>
      </div>
      <ol className="mt-4">
        {TIMELINE.map((step, index) => (
          <li key={step.title} className="relative flex gap-3 pb-4 last:pb-0">
            {index < TIMELINE.length - 1 ? (
              <span className={cn("absolute top-4 left-[7px] h-full w-0.5", step.done && TIMELINE[index + 1].done ? "bg-brand" : "bg-border")} />
            ) : null}
            <span
              className={cn(
                "relative mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                step.done ? "border-brand bg-brand text-white" : "border-border bg-background",
              )}
            >
              {step.done ? <Check className="size-2.5" strokeWidth={4} aria-hidden /> : null}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm leading-tight font-medium", !step.done && "text-muted-foreground")}>{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.meta}</p>
            </div>
          </li>
        ))}
      </ol>
    </Mock>
  );
}

const WEEK = [
  { day: "Fri", pct: 52 },
  { day: "Sat", pct: 78 },
  { day: "Sun", pct: 100 },
  { day: "Mon", pct: 41 },
  { day: "Tue", pct: 48 },
  { day: "Wed", pct: 63 },
  { day: "Thu", pct: 70 },
];

/** Drawn on the dark dashboard panel, so it carries its own light-on-dark colours. */
export function DashboardMock({ className }: { className?: string }) {
  return (
    <div
      role="img"
      aria-label="Illustration of the owner dashboard with sample data: today's sales, number of bills, tax collected, a seven day sales bar chart and the cash, UPI and card split."
      className={cn("rounded-2xl bg-white/5 p-4 text-white ring-1 ring-white/10 select-none sm:p-6", className)}
    >
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[11px] text-white/60">Today&apos;s sales</p>
          <p className="tabular mt-1 text-lg font-bold sm:text-2xl">₹48,250</p>
        </div>
        <div>
          <p className="text-[11px] text-white/60">Bills</p>
          <p className="tabular mt-1 text-lg font-bold sm:text-2xl">63</p>
        </div>
        <div>
          <p className="text-[11px] text-white/60">Tax collected</p>
          <p className="tabular mt-1 text-lg font-bold sm:text-2xl">₹4,310</p>
        </div>
      </div>

      <div className="mt-6 flex h-28 items-end gap-2 sm:h-36 sm:gap-3">
        {WEEK.map((bar, index) => (
          <div key={bar.day} className="flex h-full flex-1 flex-col justify-end gap-1.5">
            <div
              className={cn("rounded-t-md", index === WEEK.length - 1 ? "bg-saffron" : "bg-white/25")}
              style={{ height: `${bar.pct}%` }}
            />
            <span className="text-center text-[10px] text-white/60">{bar.day}</span>
          </div>
        ))}
      </div>

      <div className="mt-5">
        <div className="flex h-2 overflow-hidden rounded-full">
          <span className="bg-saffron" style={{ width: "46%" }} />
          <span className="bg-white/70" style={{ width: "38%" }} />
          <span className="bg-white/25" style={{ width: "16%" }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/70">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-saffron" /> UPI 46%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-white/70" /> Cash 38%
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-white/25" /> Card 16%
          </span>
        </div>
      </div>
      <p className="mt-4 text-[10px] text-white/40">Sample data</p>
    </div>
  );
}
