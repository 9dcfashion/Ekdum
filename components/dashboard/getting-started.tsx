"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ChecklistItem {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
  /** Ticked by hand (stored in this browser) instead of being detected. */
  manual?: boolean;
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just will not be remembered.
  }
  for (const l of listeners) l();
}

/** `null` on the server and during hydration, so nothing flashes before the stored choice is known. */
function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

export function GettingStarted({ businessId, items }: { businessId: string; items: ChecklistItem[] }) {
  const dismissKey = `ekdum:getting-started:dismissed:${businessId}`;
  const tickKey = `ekdum:getting-started:ticked:${businessId}`;
  const dismissed = useStored(dismissKey);
  const tickedRaw = useStored(tickKey);

  if (dismissed === null || tickedRaw === null || dismissed === "1") return null;

  const ticked = new Set(tickedRaw.split(",").filter(Boolean));
  const resolved = items.map((item) => ({ ...item, done: item.manual ? ticked.has(item.key) : item.done }));
  const doneCount = resolved.filter((i) => i.done).length;
  if (doneCount === resolved.length) return null;

  function toggle(key: string) {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(tickKey, [...next].join(","));
  }

  return (
    <section aria-labelledby="getting-started-title" className="mb-4 rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-title" className="font-medium">
            Getting started
          </h2>
          <p className="text-sm text-muted-foreground">
            {doneCount} of {resolved.length} done
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => write(dismissKey, "1")}>
          <X /> Dismiss
        </Button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {resolved.map((item) => (
          <li key={item.key} className="flex items-start gap-2 rounded-lg border p-2.5">
            {item.manual ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                aria-label={`${item.label}: mark as ${item.done ? "not done" : "done"}`}
                onClick={() => toggle(item.key)}
                className="mt-0.5 shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {item.done ? <CheckCircle2 className="size-5 text-primary" /> : <Circle className="size-5 text-muted-foreground" />}
              </button>
            ) : item.done ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-label="Done" />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="Not done yet" />
            )}
            <div className="min-w-0">
              <Link href={item.href} className="text-sm font-medium underline-offset-4 hover:underline">
                {item.label}
              </Link>
              <p className="text-xs text-muted-foreground">{item.manual && !item.done ? `${item.hint} Tick the circle when done.` : item.hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
