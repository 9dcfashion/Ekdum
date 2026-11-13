"use client";

import { useState } from "react";
import { formatINR, formatQty } from "@/lib/money";
import type { TopProduct } from "@/lib/reports/dashboard";
import { cn } from "@/lib/utils";

type Mode = "revenue" | "quantity";

export function TopProducts({ byRevenue, byQuantity }: { byRevenue: TopProduct[]; byQuantity: TopProduct[] }) {
  const [mode, setMode] = useState<Mode>("revenue");
  const items = mode === "revenue" ? byRevenue : byQuantity;
  const value = (p: TopProduct) => Number(mode === "revenue" ? p.revenue_paise : p.quantity);
  const max = Math.max(...items.map(value), 0);

  return (
    <div>
      <div role="group" aria-label="Rank products by" className="mb-3 inline-flex rounded-lg border bg-background p-0.5">
        {(
          [
            ["revenue", "By revenue"],
            ["quantity", "By quantity"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
            className={cn(
              "h-6 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              mode === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing sold in this period yet.</p>
      ) : (
        <ol className="grid gap-2.5">
          {items.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="tabular shrink-0 font-medium">
                  {mode === "revenue" ? formatINR(p.revenue_paise) : formatQty(p.quantity)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-[var(--chart-1)]"
                  style={{ width: `${max > 0 ? Math.max((value(p) / max) * 100, 2) : 0}%` }}
                />
              </div>
              <p className="tabular mt-0.5 text-xs text-muted-foreground">
                {mode === "revenue" ? `${formatQty(p.quantity)} sold` : formatINR(p.revenue_paise)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
