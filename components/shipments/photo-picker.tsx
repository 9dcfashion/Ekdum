"use client";

import { useId, useRef } from "react";
import { Camera, Check, ImagePlus, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PhotoItem, PhotoUploads } from "./use-photo-uploads";

const STATE_TEXT: Record<PhotoItem["state"], string> = {
  compressing: "Shrinking photo",
  uploading: "Uploading",
  done: "Uploaded",
  error: "Failed",
};

/** Camera / gallery buttons plus a preview tile per photo with its upload state, retry and remove. */
export function PhotoPicker({ uploads, disabled, className }: { uploads: PhotoUploads; disabled?: boolean; className?: string }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const full = uploads.items.length >= uploads.maxPhotos;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    uploads.addFiles(e.target.files);
    e.target.value = ""; // lets the same photo be picked again after a remove
  }

  return (
    <div className={cn("grid gap-3", className)}>
      {/* Opens the camera on phones. */}
      <input
        ref={cameraRef}
        id={`${id}-camera`}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPick}
      />
      {/* Same input without `capture`, so staff can also pick photos already on the phone. */}
      <input
        ref={galleryRef}
        id={`${id}-gallery`}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPick}
      />
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          className="h-12 md:h-9"
          disabled={disabled || full}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera aria-hidden /> Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 md:h-9"
          disabled={disabled || full}
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus aria-hidden /> Choose photos
        </Button>
      </div>

      {uploads.notice ? (
        <p className="text-xs text-muted-foreground" role="status">
          {uploads.notice}
        </p>
      ) : null}

      {uploads.items.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" aria-label="Receipt photos">
          {uploads.items.map((item, index) => (
            <li key={item.key} className="overflow-hidden rounded-xl border">
              <div className="relative aspect-square bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a remote image */}
                <img src={item.previewUrl} alt={`Receipt photo ${index + 1}`} className="size-full object-cover" />
                {item.state === "compressing" || item.state === "uploading" ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="size-6 animate-spin" aria-hidden />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => uploads.remove(item.key)}
                  disabled={disabled}
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-full border bg-background/90 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="grid gap-1 p-2">
                <p
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    item.state === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                  role="status"
                >
                  {item.state === "done" ? <Check className="size-3.5 text-primary" aria-hidden /> : null}
                  {item.state === "error" ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
                  {STATE_TEXT[item.state]}
                </p>
                {item.state === "error" ? (
                  <>
                    <p className="text-xs text-muted-foreground">{item.error}</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 md:h-8"
                      disabled={disabled}
                      onClick={() => uploads.retry(item.key)}
                    >
                      <RotateCcw aria-hidden /> Retry
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
