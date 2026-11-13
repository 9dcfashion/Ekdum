"use client";

import { useState } from "react";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { stateName } from "@/lib/gst";
import { vendorStateCode } from "@/lib/purchases/compute";
import type { VendorOption } from "@/lib/purchases/types";
import { cn } from "@/lib/utils";

/** Searchable vendor select, with "create new" when the user may manage vendors. */
export function VendorPicker({
  id,
  vendors,
  value,
  onChange,
  onCreate,
  invalid,
}: {
  id?: string;
  vendors: VendorOption[];
  value: string;
  onChange: (vendorId: string) => void;
  /** Opens the create dialog, with whatever was typed in the search box. */
  onCreate?: (typedName: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = vendors.find((v) => v.id === value);

  function createNew() {
    setOpen(false);
    onCreate?.(search.trim());
    setSearch("");
  }

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            className={cn("min-w-0 flex-1 justify-between font-normal", !selected && "text-muted-foreground")}
          >
            <span className="truncate">{selected ? selected.name : "Select vendor"}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command>
            <CommandInput placeholder="Search vendor name or GSTIN" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>
                <span className="block text-muted-foreground">No vendor found</span>
                {onCreate ? (
                  <Button type="button" variant="link" size="sm" onClick={createNew}>
                    <Plus aria-hidden /> Create {search.trim() ? `"${search.trim()}"` : "a vendor"}
                  </Button>
                ) : null}
              </CommandEmpty>
              <CommandGroup>
                {vendors.map((v) => {
                  const state = vendorStateCode(v);
                  return (
                    <CommandItem
                      key={v.id}
                      value={`${v.name} ${v.gstin ?? ""} ${v.id}`}
                      data-checked={v.id === value}
                      onSelect={() => {
                        onChange(v.id);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{v.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[v.gstin, state ? stateName(state) : null].filter(Boolean).join(" · ") || "No GSTIN"}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
            {onCreate ? (
              <div className="border-t p-1">
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={createNew}>
                  <Plus aria-hidden /> New vendor
                </Button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
      {selected ? (
        <Button type="button" variant="ghost" size="icon" aria-label="Clear vendor" onClick={() => onChange("")}>
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
