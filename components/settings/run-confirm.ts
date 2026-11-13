"use client";

import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions";

/**
 * For ConfirmDialog.onConfirm: runs a Server Action, shows a toast, and returns
 * false on failure so the dialog stays open.
 */
export async function runConfirm<T>(action: () => Promise<ActionResult<T>>, success?: string): Promise<boolean> {
  let result: ActionResult<T>;
  try {
    result = await action();
  } catch {
    toast.error("Could not reach the server. Check your connection and try again.");
    return false;
  }
  if (!result.ok) {
    toast.error(result.error);
    return false;
  }
  if (success) toast.success(success);
  return true;
}

/** Push server-side field errors into a react-hook-form instance (optionally stripping a prefix like "outlet."). */
export function applyFieldErrors(
  setError: (name: never, error: { message: string }) => void,
  fieldErrors: Record<string, string[]> | undefined,
  stripPrefix = "",
) {
  for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
    const key = stripPrefix && name.startsWith(stripPrefix) ? name.slice(stripPrefix.length) : name;
    if (key !== "_form" && messages[0]) setError(key as never, { message: messages[0] });
  }
}
