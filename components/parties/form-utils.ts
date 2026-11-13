/** Copy field errors returned by a Server Action onto a react-hook-form form. */
export function applyFieldErrors(
  setError: (name: never, error: { message: string }) => void,
  fieldErrors: Record<string, string[]> | undefined,
) {
  for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
    if (name !== "_form" && messages[0]) setError(name as never, { message: messages[0] });
  }
}
