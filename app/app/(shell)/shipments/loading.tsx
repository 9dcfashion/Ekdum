import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading shipments">
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-5 h-4 w-64" />
      <div className="mb-3 flex gap-1.5 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28 shrink-0 md:h-8" />
        ))}
      </div>
      <Skeleton className="mb-3 h-11 w-full sm:max-w-xs md:h-8" />
      <div className="grid gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl md:h-12" />
        ))}
      </div>
    </div>
  );
}
