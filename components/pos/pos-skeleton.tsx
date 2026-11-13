import { Skeleton } from "@/components/ui/skeleton";

/** Same fixed regions as the POS screen, so nothing jumps when the real screen arrives. */
export function PosSkeleton() {
  return (
    <div className="flex h-full flex-col lg:flex-row" aria-busy="true" aria-label="Loading billing screen">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
      <div className="flex h-16 shrink-0 items-center gap-3 border-t bg-background px-3 lg:hidden">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}
