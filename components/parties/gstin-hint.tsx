import { CircleAlert, CircleCheck } from "lucide-react";
import { stateName, validateGstin } from "@/lib/gst";

/** Live feedback under a GSTIN input: checks the format, state code and check digit as the user types. */
export function GstinHint({ value }: { value: string | null | undefined }) {
  const raw = (value ?? "").trim();
  if (!raw) return <p className="text-xs text-muted-foreground">15 characters. Leave empty if the party is not GST registered.</p>;
  const result = validateGstin(raw);
  if (result.valid) {
    return (
      <p className="flex items-center gap-1 text-xs text-emerald-700" role="status">
        <CircleCheck className="size-3.5 shrink-0" aria-hidden />
        Valid GSTIN · {stateName(result.stateCode)} · PAN <span className="tabular">{result.pan}</span>
      </p>
    );
  }
  const stillTyping = result.error === "length" && result.gstin.length < 15;
  return (
    <p className={stillTyping ? "text-xs text-muted-foreground" : "flex items-center gap-1 text-xs text-destructive"} role="status">
      {stillTyping ? (
        `${result.gstin.length} of 15 characters`
      ) : (
        <>
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          {result.message}
        </>
      )}
    </p>
  );
}
