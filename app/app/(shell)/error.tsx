"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <p className="mt-3 font-medium">Something went wrong on this page</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Your data is safe. Try again, and if it keeps happening, share this code with support:{" "}
        <code className="text-xs">{error.digest ?? "n/a"}</code>
      </p>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
