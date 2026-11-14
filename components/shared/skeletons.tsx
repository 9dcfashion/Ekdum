import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders shaped like the page that is about to appear, so the
 * screen never sits blank and nothing jumps when the real content arrives.
 * Every placeholder announces "Loading" to screen readers.
 */

function Busy({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A small visible "Loading…" line, for staff who would otherwise think the app froze. */
function LoadingHint({ label }: { label: string }) {
  return (
    <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground" aria-hidden>
      <Loader2 className="size-3.5 animate-spin" /> {label}
    </p>
  );
}

export function PageHeaderSkeleton({ actions = 0, back = false }: { actions?: number; back?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back ? <Skeleton className="mb-2 h-3 w-12" /> : null}
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-4 w-72 max-w-[70vw]" />
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className={cn("h-8", i === actions - 1 ? "w-28" : "w-24")} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FiltersSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Skeleton className="h-8 w-full sm:w-72" />
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-8 w-32" />
      ))}
    </div>
  );
}

/** A table on larger screens and stacked cards on phones, like the list pages. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <>
      <div className="grid gap-2 sm:hidden">
        {Array.from({ length: Math.min(rows, 6) }, (_, i) => (
          <div key={i} className="rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="mt-2 h-3 w-48" />
          </div>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-xl border sm:block">
        <div className="flex gap-4 border-b bg-muted/40 px-4 py-2.5">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} className={cn("h-3", i === 1 ? "w-40" : "w-20")} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            {Array.from({ length: columns }, (_, i) => (
              <Skeleton key={i} className={cn("h-4", i === 1 ? "w-40" : i === columns - 1 ? "ml-auto w-16" : "w-20")} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function ListPageSkeleton({
  label = "Loading the list",
  actions = 1,
  filters = 2,
  columns = 6,
  rows = 8,
  tabs = false,
}: {
  label?: string;
  actions?: number;
  filters?: number;
  columns?: number;
  rows?: number;
  tabs?: boolean;
}) {
  return (
    <Busy label={label}>
      <PageHeaderSkeleton actions={actions} />
      {tabs ? (
        <div className="mb-4 flex gap-3 border-b pb-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
      ) : null}
      <FiltersSkeleton count={filters} />
      <TableSkeleton rows={rows} columns={columns} />
    </Busy>
  );
}

function FieldSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className={cn("grid gap-1.5", wide && "sm:col-span-2")}>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

/** Forms: a card of label + field pairs and the save buttons. */
export function FormPageSkeleton({
  label = "Loading the form",
  sections = 2,
  fields = 6,
  back = true,
  header = true,
}: {
  label?: string;
  sections?: number;
  fields?: number;
  back?: boolean;
  header?: boolean;
}) {
  return (
    <Busy label={label}>
      {header ? <PageHeaderSkeleton back={back} /> : null}
      <LoadingHint label="Loading…" />
      <div className="grid gap-4">
        {Array.from({ length: sections }, (_, s) => (
          <div key={s} className="rounded-xl border p-4 sm:p-5">
            <Skeleton className="mb-4 h-4 w-32" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: fields }, (_, f) => (
                <FieldSkeleton key={f} wide={f === 0 && s === 0} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
      </div>
    </Busy>
  );
}

/** A single record: info cards, a table of lines and a totals card. */
export function DetailPageSkeleton({ label = "Loading details", lines = 4 }: { label?: string; lines?: number }) {
  return (
    <Busy label={label}>
      <PageHeaderSkeleton back actions={2} />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border p-4">
            <Skeleton className="mb-3 h-4 w-28" />
            <Skeleton className="mb-2 h-4 w-48" />
            <Skeleton className="mb-2 h-3 w-64 max-w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <TableSkeleton rows={lines} columns={6} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border p-4">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="grid gap-2 rounded-xl border p-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </Busy>
  );
}

/** Settings pages keep their header and tabs on screen; only the section below loads. */
export function SettingsSectionSkeleton({ label = "Loading settings", kind = "form" }: { label?: string; kind?: "form" | "list" }) {
  return (
    <Busy label={label} className="rounded-xl border p-4 sm:p-5">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 mb-5 h-4 w-96 max-w-full" />
      {kind === "form" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <FieldSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="ml-auto h-7 w-16" />
            </div>
          ))}
        </div>
      )}
    </Busy>
  );
}

/** Full-screen pages with no app frame (setup, onboarding, print): a centred spinner with words. */
export function FullScreenLoader({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("flex min-h-dvh flex-col items-center justify-center gap-3 px-4", className)}>
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
