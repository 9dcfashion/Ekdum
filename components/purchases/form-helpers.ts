import type { ActionResult } from "@/lib/actions";

/** Copy server-side field errors onto a react-hook-form form. */
export function applyFieldErrors(
  setError: (name: never, error: { message: string }) => void,
  fieldErrors: Record<string, string[]> | undefined,
) {
  for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
    if (name !== "_form" && messages[0]) setError(name as never, { message: messages[0] });
  }
}

/** Await a Server Action, turning a network failure into an ordinary error result. */
export async function callAction<T>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}
