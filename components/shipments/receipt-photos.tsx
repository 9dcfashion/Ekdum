"use client";

import { useState } from "react";
import { ExternalLink, ImageOff, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SubmitButton } from "@/components/shared/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAction } from "@/lib/use-action";
import { addShipmentPhotosAction, removeShipmentPhotoAction } from "@/app/app/(shell)/shipments/actions";
import { PhotoPicker } from "./photo-picker";
import { usePhotoUploads } from "./use-photo-uploads";

export interface ReceiptPhoto {
  path: string;
  /** Short-lived signed URL; null when the file could not be found. */
  url: string | null;
}

/** Saved receipt photos (tap to see full size) and, for those allowed, adding or removing photos. */
export function ReceiptPhotos({
  shipmentId,
  businessId,
  photos,
  canEdit,
  maxPhotos,
}: {
  shipmentId: string;
  businessId: string;
  photos: ReceiptPhoto[];
  canEdit: boolean;
  maxPhotos: number;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  const current = viewing !== null ? photos[viewing] : undefined;

  async function remove(path: string) {
    try {
      const result = await removeShipmentPhotoAction({ id: shipmentId, path });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      toast.success("Photo removed");
      return true;
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
      return false;
    }
  }

  return (
    <div className="grid gap-3">
      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No receipt photos yet.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Receipt photos">
          {photos.map((photo, index) => (
            <li key={photo.path} className="relative">
              {photo.url ? (
                <button
                  type="button"
                  onClick={() => setViewing(index)}
                  aria-label={`View receipt photo ${index + 1} full size`}
                  className="block aspect-square w-full overflow-hidden rounded-xl border bg-muted outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket */}
                  <img src={photo.url} alt={`Receipt photo ${index + 1}`} loading="lazy" className="size-full object-cover" />
                </button>
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border bg-muted text-xs text-muted-foreground">
                  <ImageOff className="size-5" aria-hidden />
                  Not available
                </div>
              )}
              {canEdit ? (
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      aria-label={`Remove receipt photo ${index + 1}`}
                      className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-full border bg-background/90 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  }
                  title="Remove this photo?"
                  description="The photo will be deleted from this shipment. This cannot be undone."
                  confirmLabel="Remove photo"
                  destructive
                  onConfirm={() => remove(photo.path)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && photos.length < maxPhotos ? (
        <AddPhotos shipmentId={shipmentId} businessId={businessId} room={maxPhotos - photos.length} />
      ) : null}

      <Dialog open={!!current} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Receipt photo {viewing !== null ? viewing + 1 : ""}</DialogTitle>
            <DialogDescription className="sr-only">Full size receipt photo</DialogDescription>
          </DialogHeader>
          {current?.url ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from a private bucket */}
              <img src={current.url} alt={`Receipt photo ${(viewing ?? 0) + 1}`} className="max-h-[75dvh] w-full rounded-lg object-contain" />
              <Button variant="outline" asChild className="h-11 md:h-8">
                <a href={current.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden /> Open in a new tab
                </a>
              </Button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddPhotos({ shipmentId, businessId, room }: { shipmentId: string; businessId: string; room: number }) {
  const uploads = usePhotoUploads(businessId, room);
  const { run, pending } = useAction();
  const ready = uploads.paths.length;

  return (
    <div className="grid gap-3 border-t pt-3">
      <p className="text-sm font-medium">Add more photos</p>
      <PhotoPicker uploads={uploads} disabled={pending} />
      {uploads.items.length > 0 ? (
        <>
          {uploads.failed > 0 ? (
            <p className="text-xs text-destructive" role="alert">
              A photo did not upload. Retry it or remove it. The others can still be saved.
            </p>
          ) : null}
          <SubmitButton
            type="button"
            pending={pending}
            pendingText="Saving"
            disabled={uploads.busy || ready === 0}
            className="h-12 md:h-9"
            onClick={() =>
              run(() => addShipmentPhotosAction({ id: shipmentId, paths: uploads.paths }), {
                success: ready === 1 ? "Photo added" : `${ready} photos added`,
                // Keep failed photos on screen so they can still be retried.
                onSuccess: () => (uploads.failed > 0 ? uploads.forget(uploads.paths) : uploads.reset()),
              })
            }
          >
            {uploads.busy ? "Photos uploading" : ready === 1 ? "Save 1 photo" : `Save ${ready} photos`}
          </SubmitButton>
        </>
      ) : null}
    </div>
  );
}
