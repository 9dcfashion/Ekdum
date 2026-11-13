"use client";

import { Copy, MailCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface InviteLinkResult {
  email: string;
  acceptUrl: string;
  emailed: boolean;
  testMode: boolean;
}

export function copyInviteLink(url: string) {
  navigator.clipboard.writeText(url).then(
    () => toast.success("Invite link copied. You can share it on WhatsApp."),
    () => toast.error("Could not copy the link. Select it and copy it yourself."),
  );
}

/** Shown once after an invite is created or resent: the only time the link is available. */
export function InviteLinkPanel({ result }: { result: InviteLinkResult }) {
  const delivered = result.emailed && !result.testMode;
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        {delivered ? (
          <MailCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        )}
        <p>
          {delivered ? (
            <>
              We emailed the invite to <span className="font-medium">{result.email}</span>.
            </>
          ) : result.testMode ? (
            <>
              Email is in test mode, so nothing was sent to <span className="font-medium">{result.email}</span>. Copy the
              link below and share it yourself.
            </>
          ) : (
            <>
              The email to <span className="font-medium">{result.email}</span> could not be sent. Copy the link below and
              share it yourself.
            </>
          )}
        </p>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="invite-link" className="text-sm font-medium">
          Invite link
        </label>
        <div className="flex gap-2">
          <Input id="invite-link" readOnly value={result.acceptUrl} onFocus={(e) => e.currentTarget.select()} className="text-xs" />
          <Button type="button" variant="outline" onClick={() => copyInviteLink(result.acceptUrl)}>
            <Copy aria-hidden /> Copy invite link
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The link works only for this email address, until the invite expires. It is shown only now, so copy it before closing.
        </p>
      </div>
    </div>
  );
}
