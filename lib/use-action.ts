"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions";

/**
 * Run a Server Action from a Client Component with a pending flag and toasts.
 *   const { run, pending } = useAction();
 *   run(() => saveThing(values), { success: "Saved", onSuccess: (data) => … });
 */
export function useAction() {
  const [pending, startTransition] = useTransition();

  function run<T>(
    action: () => Promise<ActionResult<T>>,
    opts: {
      success?: string | ((data: T) => string);
      onSuccess?: (data: T) => void;
      onError?: (error: string, fieldErrors?: Record<string, string[]>) => void;
      silentError?: boolean;
    } = {},
  ) {
    startTransition(async () => {
      let result: ActionResult<T>;
      try {
        result = await action();
      } catch {
        toast.error("Could not reach the server. Check your connection and try again.");
        return;
      }
      if (result.ok) {
        const message = typeof opts.success === "function" ? opts.success(result.data) : opts.success;
        if (message) toast.success(message);
        opts.onSuccess?.(result.data);
      } else {
        if (!opts.silentError) toast.error(result.error);
        opts.onError?.(result.error, result.fieldErrors);
      }
    });
  }

  return { run, pending };
}
