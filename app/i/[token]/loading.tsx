import { Skeleton } from "@/components/ui/skeleton";

/** The public bill: a header with the download button, then the boxed bill. */
export default function Loading() {
  return (
    <main role="status" aria-live="polite" aria-busy="true" className="mx-auto w-full max-w-4xl px-3 py-6 sm:px-6">
      <span className="sr-only">Loading the bill</span>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-lg" />
          <div>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-2 h-3.5 w-32" />
          </div>
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="rounded-lg border p-4">
        <Skeleton className="mx-auto h-6 w-64 max-w-full" />
        <Skeleton className="mx-auto mt-2 h-3.5 w-80 max-w-full" />
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <div className="mt-5 grid gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </div>
    </main>
  );
}
