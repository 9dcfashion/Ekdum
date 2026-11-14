"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, RotateCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressPhoto } from "@/lib/images";
import { attachSalePhotosAction } from "@/lib/sales/photo-actions";
import { BUCKETS, UPLOAD_LIMITS, salePhotoPath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type Status = "shrinking" | "uploading" | "saving" | "done" | "failed";

interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  status: Status;
  /** Set once the file is in storage, so a retry only redoes what failed. */
  path: string | null;
  error: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  shrinking: "Preparing…",
  uploading: "Uploading…",
  saving: "Saving…",
  done: "Saved",
  failed: "Failed",
};

/**
 * Attach photos of what was handed over to a posted bill. Photos are shrunk in
 * the browser, uploaded straight to private storage under the bill's folder,
 * then recorded against the bill. Used after payment at the POS and on the bill page.
 */
export function SalePhotoUploader({
  businessId,
  invoiceId,
  existingCount = 0,
  onBusyChange,
  onSaved,
  className,
}: {
  businessId: string;
  invoiceId: string;
  /** Photos already on the bill, to respect the per-bill limit. */
  existingCount?: number;
  /** True while any photo is still being prepared, uploaded or saved. */
  onBusyChange?: (busy: boolean) => void;
  /** After each photo is recorded (e.g. refresh the page). */
  onSaved?: () => void;
  className?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<PhotoItem[]>([]);
  const urls = useRef<string[]>([]);

  const busy = items.some((i) => i.status === "shrinking" || i.status === "uploading" || i.status === "saving");
  const remaining = UPLOAD_LIMITS.salePhoto.maxPerBill - existingCount - items.filter((i) => i.status !== "failed").length;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const update = (id: string, patch: Partial<PhotoItem>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  async function process(item: PhotoItem) {
    let path = item.path;
    try {
      if (!path) {
        update(item.id, { status: "shrinking", error: null });
        const file = await compressPhoto(item.file, { maxSizeMB: 0.6, maxDimension: 1600 });
        if (!(UPLOAD_LIMITS.salePhoto.types as readonly string[]).includes(file.type)) throw new Error("Use a JPG, PNG or WebP photo");
        if (file.size > UPLOAD_LIMITS.salePhoto.maxBytes) throw new Error("The photo is too large (max 5 MB)");

        update(item.id, { status: "uploading" });
        const target = salePhotoPath(businessId, invoiceId, file.name);
        const { error } = await createClient().storage.from(BUCKETS.salePhotos).upload(target, file, { contentType: file.type, upsert: false });
        if (error) throw new Error(error.message.includes("row-level security") ? "You cannot add photos to this bill" : "Upload failed. Check your connection.");
        path = target;
        update(item.id, { path });
      }

      update(item.id, { status: "saving", error: null });
      const result = await attachSalePhotosAction({ invoice_id: invoiceId, paths: [path] });
      if (!result.ok) throw new Error(result.error);
      update(item.id, { status: "done" });
      onSaved?.();
    } catch (error) {
      update(item.id, { status: "failed", error: error instanceof Error ? error.message : "Could not add the photo" });
    }
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(remaining, 0));
    const fresh: PhotoItem[] = picked.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      urls.current.push(previewUrl);
      return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, previewUrl, status: "shrinking", path: null, error: null };
    });
    setItems((list) => [...list, ...fresh]);
    fresh.forEach((item) => void process(item));
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  }

  function discard(id: string) {
    // Only failed photos can be dropped here; saved ones are removed by a manager from the bill page.
    setItems((list) => list.filter((i) => i.id !== id));
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button type="button" variant="outline" className="h-10" disabled={remaining <= 0} onClick={() => cameraRef.current?.click()}>
          <Camera aria-hidden /> Take photo
        </Button>
        <Button type="button" variant="ghost" className="h-10" disabled={remaining <= 0} onClick={() => galleryRef.current?.click()}>
          <ImagePlus aria-hidden /> Choose photos
        </Button>
        {remaining <= 0 ? <span className="text-xs text-muted-foreground">This bill has the maximum of {UPLOAD_LIMITS.salePhoto.maxPerBill} photos.</span> : null}
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Photos being added">
          {items.map((item) => (
            <li key={item.id} className="w-24">
              <div className="relative size-24 overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.previewUrl} alt="" className={cn("size-full object-cover", item.status !== "done" && "opacity-60")} />
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/90 py-0.5 text-[11px]">
                  {item.status === "done" ? (
                    <CheckCircle2 className="size-3 text-emerald-600" aria-hidden />
                  ) : item.status === "failed" ? (
                    <TriangleAlert className="size-3 text-destructive" aria-hidden />
                  ) : (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  )}
                  {STATUS_LABEL[item.status]}
                </span>
              </div>
              {item.status === "failed" ? (
                <div className="mt-1 flex items-center justify-between gap-1">
                  <button type="button" onClick={() => void process(item)} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline">
                    <RotateCw className="size-3" aria-hidden /> Retry
                  </button>
                  <button type="button" onClick={() => discard(item.id)} aria-label="Remove this photo" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}
              {item.error ? (
                <p className="mt-0.5 text-[11px] leading-tight text-destructive" role="alert">
                  {item.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
