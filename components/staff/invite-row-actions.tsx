"use client";

import { useState } from "react";
import { Loader2, RotateCw, X } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { runConfirm } from "@/components/settings/run-confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/lib/use-action";
import { resendInviteAction, revokeInviteAction } from "@/app/app/(shell)/staff/actions";
import { InviteLinkPanel, type InviteLinkResult } from "./invite-link";

export function InviteRowActions({ invitationId, email }: { invitationId: string; email: string }) {
  const { run, pending } = useAction();
  const [result, setResult] = useState<InviteLinkResult | null>(null);

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => run(() => resendInviteAction({ invitation_id: invitationId }), { onSuccess: setResult })}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />} Resend
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            <X aria-hidden /> Revoke
          </Button>
        }
        title="Revoke this invite?"
        description={`The link sent to ${email} will stop working straight away. You can invite them again later.`}
        confirmLabel="Revoke invite"
        destructive
        onConfirm={() => runConfirm(() => revokeInviteAction({ invitation_id: invitationId }), "Invite revoked")}
      />

      <Dialog open={!!result} onOpenChange={(next) => !next && setResult(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New invite link</DialogTitle>
            <DialogDescription>The earlier link no longer works. Share this one instead.</DialogDescription>
          </DialogHeader>
          {result ? <InviteLinkPanel result={result} /> : null}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
