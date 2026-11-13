import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading the audit log">
      <Skeleton className="mb-2 h-5 w-32" />
      <Skeleton className="mb-5 h-4 w-96 max-w-full" />
      <Skeleton className="mb-3 h-8 w-72 max-w-full" />
      <div className="grid gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
