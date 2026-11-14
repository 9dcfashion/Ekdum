"use client";

import { useId, useMemo, useState } from "react";
import { Check, Plus, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stateName } from "@/lib/gst";
import { vendorStateCode } from "@/lib/purchases/compute";
import { filterVendors, orderVendorsByRecent } from "@/lib/purchases/flow";
import type { VendorOption } from "@/lib/purchases/types";
import { cn } from "@/lib/utils";

/** How many suppliers to list before asking the user to type. */
const LIST_LIMIT = 25;

function describe(v: VendorOption): string {
  const state = vendorStateCode(v);
  return [v.gstin, state ? stateName(state) : null, v.phone].filter(Boolean).join(" · ") || "No GSTIN";
}

/**
 * Supplier choice as big rows: recent suppliers first, then everyone A to Z,
 * with a search box (name, GSTIN or phone). Arrow keys and Enter work in the
 * search box, so a keyboard user never has to tab through the rows.
 */
export function SupplierPicker({
  id,
  vendors,
  recentIds,
  value,
  onChange,
  onCreate,
  error,
}: {
  id?: string;
  vendors: VendorOption[];
  recentIds: string[];
  value: string;
  onChange: (vendorId: string) => void;
  /** Opens "New supplier" with whatever was typed. Absent when the user may not add suppliers. */
  onCreate?: (typedName: string) => void;
  error?: string;
}) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  /** Row picked with the arrow keys; -1 = none. */
  const [active, setActive] = useState(-1);
  const selected = vendors.find((v) => v.id === value) ?? null;

  const { recent, others } = useMemo(() => orderVendorsByRecent(vendors, recentIds), [vendors, recentIds]);
  const text = q.trim();
  const groups = useMemo(() => {
    if (text) return [{ title: null as string | null, rows: filterVendors(vendors, text).slice(0, LIST_LIMIT) }];
    return [
      { title: recent.length > 0 ? "Recent" : null, rows: recent },
      { title: recent.length > 0 ? "All suppliers" : null, rows: others.slice(0, LIST_LIMIT - recent.length) },
    ].filter((g) => g.rows.length > 0);
  }, [text, vendors, recent, others]);
  const flat = groups.flatMap((g) => g.rows);
  const hidden = Math.max(0, text ? filterVendors(vendors, text).length - LIST_LIMIT : others.length - Math.max(0, LIST_LIMIT - recent.length));

  function choose(vendor: VendorOption) {
    onChange(vendor.id);
    setPicking(false);
    setQ("");
    setActive(-1);
  }

  function create() {
    onCreate?.(text);
    setQ("");
  }

  if (selected && !picking) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{selected.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{describe(selected)}</span>
        </span>
        <Button id={id} type="button" variant="outline" className="h-11 shrink-0 px-4" onClick={() => setPicking(true)}>
          Change
        </Button>
      </div>
    );
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const current = Math.min(active, flat.length - 1);

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={id}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const pick = flat[current] ?? (text ? flat[0] : undefined);
              if (pick) choose(pick);
              else if (onCreate && text) create();
            } else if (e.key === "Escape" && selected) {
              e.preventDefault();
              setPicking(false);
              setQ("");
            }
          }}
          placeholder="Search name, mobile or GSTIN"
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-invalid={!!error || undefined}
          className="h-12 pl-10 text-base"
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {onCreate ? (
        <Button type="button" variant="outline" className="mt-3 h-12 w-full min-w-0 justify-start border-dashed text-base" onClick={create}>
          <Plus className="size-5" aria-hidden />
          <span className="min-w-0 truncate">{text ? `New supplier "${text}"` : "New supplier"}</span>
        </Button>
      ) : null}

      <div id={listId} role="listbox" aria-label="Suppliers" className="mt-3 grid gap-3">
        {groups.map((group, gi) => {
          const offset = groups.slice(0, gi).reduce((n, g) => n + g.rows.length, 0);
          return (
            <div key={group.title ?? gi} role="group" aria-label={group.title ?? undefined}>
              {group.title ? <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.title}</p> : null}
              <ul className="divide-y overflow-hidden rounded-xl border">
                {group.rows.map((v, i) => {
                  const index = offset + i;
                  const isActive = index === current;
                  return (
                    <li key={v.id}>
                      <button
                        id={optionId(index)}
                        type="button"
                        role="option"
                        aria-selected={v.id === value}
                        tabIndex={-1}
                        onClick={() => choose(v)}
                        onMouseEnter={() => setActive(index)}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted active:bg-muted",
                          isActive && "bg-muted",
                        )}
                      >
                        <Store className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-medium">{v.name}</span>
                          <span className="block truncate text-sm text-muted-foreground">{describe(v)}</span>
                        </span>
                        {v.id === value ? <Check className="size-5 shrink-0 text-primary" aria-hidden /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {flat.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-base text-muted-foreground">
            {vendors.length === 0 ? "No suppliers yet." : `No supplier matches "${text}".`}
            {onCreate ? " Tap New supplier to add one." : " Ask the owner or a manager to add the supplier."}
          </p>
        ) : hidden > 0 ? (
          <p className="text-center text-sm text-muted-foreground">Type a name to find {hidden} more.</p>
        ) : null}
      </div>
      {selected ? (
        <Button type="button" variant="ghost" className="mt-2 h-11 w-full min-w-0" onClick={() => setPicking(false)}>
          <span className="min-w-0 truncate">Keep {selected.name}</span>
        </Button>
      ) : null}
    </div>
  );
}
