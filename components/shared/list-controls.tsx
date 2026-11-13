"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "./field";
import { cn } from "@/lib/utils";

/** Update one or more URL search params (and reset to page 1). Lists read their filters from the URL. */
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParams(updates: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (!opts.keepPage) params.delete("page");
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return { searchParams, setParams, pending };
}

/** Debounced search box bound to the `q` URL param. */
export function SearchInput({
  placeholder = "Search…",
  param = "q",
  className,
  autoFocus,
}: {
  placeholder?: string;
  param?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const { searchParams, setParams, pending } = useListParams();
  const initial = searchParams.get(param) ?? "";
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function update(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setParams({ [param]: next.trim() || null }), 300);
  }

  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(e) => update(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {pending ? (
        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />
      ) : value ? (
        <button
          type="button"
          onClick={() => update("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** A <select> bound to a URL param. An option with value "" clears the filter. */
export function FilterSelect({
  param,
  options,
  label,
  className,
}: {
  param: string;
  options: Array<{ value: string; label: string }>;
  label: string;
  className?: string;
}) {
  const { searchParams, setParams } = useListParams();
  return (
    <NativeSelect
      aria-label={label}
      value={searchParams.get(param) ?? ""}
      onChange={(e) => setParams({ [param]: e.target.value || null })}
      className={cn("w-auto min-w-32", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Date input bound to a URL param (YYYY-MM-DD). */
export function FilterDate({ param, label, className }: { param: string; label: string; className?: string }) {
  const { searchParams, setParams } = useListParams();
  return (
    <Input
      type="date"
      aria-label={label}
      title={label}
      value={searchParams.get(param) ?? ""}
      onChange={(e) => setParams({ [param]: e.target.value || null })}
      className={cn("w-auto", className)}
    />
  );
}

/** Prev / next pagination that keeps the other URL params. */
export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return total > 0 ? <p className="mt-3 text-xs text-muted-foreground">{total} in total</p> : null;
  }

  const href = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete("page");
    else params.set("page", String(p));
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Pagination">
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" asChild={page > 1} disabled={page <= 1}>
          {page > 1 ? (
            <Link href={href(page - 1)} scroll={false}>
              <ChevronLeft /> Prev
            </Link>
          ) : (
            <span>
              <ChevronLeft /> Prev
            </span>
          )}
        </Button>
        <span className="px-1 text-xs text-muted-foreground">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" asChild={page < pages} disabled={page >= pages}>
          {page < pages ? (
            <Link href={href(page + 1)} scroll={false}>
              Next <ChevronRight />
            </Link>
          ) : (
            <span>
              Next <ChevronRight />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
