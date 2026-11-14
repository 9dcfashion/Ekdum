"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteSalePhotoAction } from "@/lib/sales/photo-actions";
import { useAction } from "@/lib/use-action";
import { SalePhotoUploader } from "./sale-photo-uploader";

/** Adds photos to a bill from its page and refreshes the list as each one is saved. */
export function AddSalePhotos({ businessId, invoiceId, existingCount }: { businessId: string; invoiceId: string; existingCount: number }) {
  const router = useRouter();
  return <SalePhotoUploader businessId={businessId} invoiceId={invoiceId} existingCount={existingCount} onSaved={() => router.refresh()} />;
}

/** Owners and managers can remove a photo. The removal is kept in the audit log. */
export function RemoveSalePhoto({ photoId }: { photoId: string }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove this photo">
          <Trash2 />
        </Button>
      }
      title="Remove this photo?"
      description="The photo is deleted from the bill. The removal is recorded in the audit log with your name."
      confirmLabel="Remove photo"
      destructive
      onConfirm={() =>
        new Promise<boolean>((resolve) =>
          run(() => deleteSalePhotoAction({ photo_id: photoId }), {
            success: "Photo removed",
            onSuccess: () => {
              router.refresh();
              resolve(true);
            },
            onError: () => resolve(false),
          }),
        )
      }
    />
  );
}
