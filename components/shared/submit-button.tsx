"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A button that shows a spinner and blocks double-submits while `pending`. */
export function SubmitButton({
  pending,
  children,
  pendingText,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean; pendingText?: string }) {
  return (
    <Button type="submit" aria-busy={pending} {...props} disabled={pending || props.disabled}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
