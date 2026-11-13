import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading report">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-5 h-4 w-80 max-w-full" />
      <Skeleton className="mb-4 h-8 w-full max-w-md" />
      <div className="overflow-hidden rounded-xl border">
        <Skeleton className="h-9 w-full rounded-none" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="border-t px-2.5 py-2">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
