import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A dashboard card: title, optional link, content. */
export function DashCard({
  title,
  description,
  href,
  linkLabel,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  href?: string;
  linkLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-xl border bg-card p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{title}</h2>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 text-xs text-primary underline-offset-4 hover:underline">
            {linkLabel ?? "View"} <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The four headline numbers. */
export function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="tabular mt-1 truncate text-2xl font-semibold tracking-tight" title={value}>
        {value}
      </p>
      {hint ? <p className="tabular mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Small secondary figure under the headline tiles. */
export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** A label, a figure and a proportion bar. */
export function BarRow({ label, value, sub, share }: { label: string; value: string; sub?: string; share: number }) {
  const pct = Number.isFinite(share) ? Math.min(Math.max(share, 0), 1) * 100 : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular shrink-0 font-medium">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${pct > 0 ? Math.max(pct, 2) : 0}%` }} />
      </div>
      {sub ? <p className="tabular mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </li>
  );
}
