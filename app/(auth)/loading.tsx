import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 grid gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-1.5">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
        <Skeleton className="h-9 w-full" />
      </div>
    </div>
  );
}
