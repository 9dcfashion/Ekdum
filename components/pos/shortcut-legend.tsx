"use client";

import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export const POS_SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["F2"], label: "Search or scan an item" },
  { keys: ["Enter"], label: "Add the scanned or selected item" },
  { keys: ["↑", "↓"], label: "Move through search results or bill lines" },
  { keys: ["+", "-"], label: "Change quantity of the selected line" },
  { keys: ["Delete"], label: "Remove the selected line" },
  { keys: ["F4"], label: "Customer" },
  { keys: ["F6"], label: "Add an item not in your product list" },
  { keys: ["F8"], label: "Bill discount" },
  { keys: ["F9"], label: "Take payment" },
  { keys: ["Esc"], label: "Close, or clear the bill" },
];

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[0.7rem] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

/** The keyboard shortcut list, opened from the POS top bar. */
export function ShortcutLegend() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {/* Phones have no F-keys: the button only shows where the keyboard-first screen does. */}
        <Button variant="outline" size="sm" aria-label="Keyboard shortcuts" className="hidden lg:inline-flex">
          <Keyboard aria-hidden />
          <span className="hidden md:inline">Shortcuts</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Bill faster without touching the mouse.</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {POS_SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3">
              <span>{s.label}</span>
              <span className="flex shrink-0 gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
