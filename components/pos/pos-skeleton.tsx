import { Skeleton } from "@/components/ui/skeleton";

/** Same fixed regions as the POS screen, so nothing jumps when the real screen arrives. */
export function PosSkeleton() {
  return (
    <div className="flex h-full flex-col lg:flex-row" aria-busy="true" aria-label="Loading billing screen">
      {/* Desktop: search, bill lines, toolbar | totals column */}
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col lg:flex">
        <div className="shrink-0 border-b bg-background p-2 sm:p-3">
          <Skeleton className="h-11 w-full" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden bg-background">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex h-14 items-center gap-3 border-b px-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-8 w-28 sm:block" />
              <Skeleton className="hidden h-8 w-20 sm:block" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="flex h-12 shrink-0 items-center gap-2 border-t bg-background px-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="hidden w-88 shrink-0 flex-col gap-3 border-l bg-background p-3 lg:flex">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="min-h-0 w-full flex-1" />
        <Skeleton className="h-14 w-full" />
      </div>

      {/* Phone: search, item tiles, bill bar */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="flex shrink-0 gap-2 border-b bg-background p-2">
          <Skeleton className="h-12 flex-1 rounded-xl" />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-hidden p-2 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Skeleton className="h-14 flex-1 rounded-xl" />
          <Skeleton className="h-14 w-28 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
