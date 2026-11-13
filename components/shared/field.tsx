import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Label + control + hint/error, wired for accessibility.
 * Pass the control as the child; `error` shows below it in red.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor} className="text-sm">
          {label}
          {required ? (
            <span className="text-destructive" aria-hidden>
              *
            </span>
          ) : null}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const controlClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm";

/** A styled native <select>. Works with react-hook-form's register() and is touch friendly. */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select data-slot="native-select" className={cn(controlClass, "pr-7", className)} {...props}>
      {children}
    </select>
  );
}

/** Rupee amount input: text field with a ₹ prefix and a numeric keypad on touch devices. */
export function MoneyInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        ₹
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        data-slot="money-input"
        className={cn(controlClass, "tabular pl-6", className)}
        {...props}
      />
    </div>
  );
}
