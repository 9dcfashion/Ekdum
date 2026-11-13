"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A small text field for cart cells. It shows `value` until the cashier types,
 * then keeps the draft until Enter or blur commits it. Esc throws the draft away.
 * `onCommit` returns false to say the value was refused (the field snaps back).
 */
export function CommitInput({
  value,
  onCommit,
  onDone,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onCommit: (value: string) => boolean | void;
  /** Called after Enter or Esc, e.g. to send focus back to the search box. */
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc sets this so the blur that follows does not commit the abandoned draft.
  const discard = useRef(false);

  function commit() {
    if (!discard.current && draft !== null && draft.trim() !== value) onCommit(draft.trim());
    discard.current = false;
    setDraft(null);
  }

  return (
    <input
      type="text"
      autoComplete="off"
      {...props}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        e.target.select();
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        commit();
        props.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        // Blur does the commit, so Enter and blur can never commit twice.
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          onDone?.();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          discard.current = true;
          e.currentTarget.blur();
          onDone?.();
        }
        props.onKeyDown?.(e);
      }}
      className={cn(
        "tabular h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-right text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
    />
  );
}
