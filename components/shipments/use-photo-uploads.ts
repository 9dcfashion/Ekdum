"use client";

import { useEffect, useRef, useState } from "react";
import { compressPhoto } from "@/lib/images";
import { BUCKETS, storagePath, UPLOAD_LIMITS } from "@/lib/storage";
import { createClient } from "@/lib/supabase/browser";

export type PhotoState = "compressing" | "uploading" | "done" | "error";

export interface PhotoItem {
  key: string;
  name: string;
  previewUrl: string;
  state: PhotoState;
  /** Set once the upload has finished. */
  path: string | null;
  error: string | null;
}

const LIMIT = UPLOAD_LIMITS.shipmentReceipt;

/**
 * Receipt photos: each file is compressed in the browser and uploaded on its own,
 * so one failure never affects the others or the rest of the form. Failed photos can be retried.
 */
export function usePhotoUploads(businessId: string, maxPhotos: number) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Files are kept outside state (they are not rendered) so a retry can reuse them.
  const files = useRef(new Map<string, File>());
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function patch(key: string, changes: Partial<PhotoItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }

  async function uploadOne(key: string) {
    const original = files.current.get(key);
    if (!original) return;
    try {
      patch(key, { state: "compressing", error: null });
      const file = await compressPhoto(original);
      if (!(LIMIT.types as readonly string[]).includes(file.type)) {
        throw new Error("This photo format is not supported. Use JPG or PNG.");
      }
      if (file.size > LIMIT.maxBytes) throw new Error("This photo is too large (5 MB at most).");
      // Still wanted? The user may have removed it while it was being compressed.
      if (!files.current.has(key)) return;

      patch(key, { state: "uploading" });
      const path = storagePath(businessId, "receipts", file.name);
      const { error } = await createClient()
        .storage.from(BUCKETS.shipmentReceipts)
        .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
      if (error) {
        throw new Error(
          /row-level security|permission|unauthorized|403/i.test(error.message)
            ? "You don't have permission to upload photos."
            : "Upload failed. Check your connection and retry.",
        );
      }
      if (!files.current.has(key)) {
        // Removed while uploading: tidy up (allowed only for roles that may delete; otherwise the file is simply unused).
        void createClient().storage.from(BUCKETS.shipmentReceipts).remove([path]);
        return;
      }
      patch(key, { state: "done", path });
    } catch (e) {
      patch(key, { state: "error", error: e instanceof Error && e.message ? e.message : "Upload failed. Retry." });
    }
  }

  function addFiles(list: FileList | File[] | null) {
    const incoming = Array.from(list ?? []);
    if (incoming.length === 0) return;
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    const room = Math.max(0, maxPhotos - items.length);
    const accepted = images.slice(0, room);
    if (images.length < incoming.length) setNotice("Only photos can be attached.");
    else if (accepted.length < images.length) setNotice(`You can attach up to ${maxPhotos} photos.`);
    else setNotice(null);

    const added: PhotoItem[] = accepted.map((file) => {
      const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      files.current.set(key, file);
      previews.current.add(previewUrl);
      return { key, name: file.name, previewUrl, state: "compressing", path: null, error: null };
    });
    if (added.length === 0) return;
    setItems((current) => [...current, ...added]);
    for (const item of added) void uploadOne(item.key);
  }

  function retry(key: string) {
    void uploadOne(key);
  }

  function remove(key: string) {
    const item = items.find((i) => i.key === key);
    files.current.delete(key);
    if (item) {
      URL.revokeObjectURL(item.previewUrl);
      previews.current.delete(item.previewUrl);
      // Best effort: only roles allowed to delete can remove the file; otherwise it is just left unused.
      if (item.path) void createClient().storage.from(BUCKETS.shipmentReceipts).remove([item.path]);
    }
    setItems((current) => current.filter((i) => i.key !== key));
  }

  /** Forget everything without deleting the uploaded files (they now belong to a saved shipment). */
  function reset() {
    files.current.clear();
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
    setItems([]);
    setNotice(null);
  }

  /** Drop saved photos from the list (their files stay; they now belong to a shipment). */
  function forget(savedPaths: string[]) {
    const gone = items.filter((i) => i.path && savedPaths.includes(i.path));
    for (const item of gone) {
      files.current.delete(item.key);
      URL.revokeObjectURL(item.previewUrl);
      previews.current.delete(item.previewUrl);
    }
    setItems((current) => current.filter((i) => !(i.path && savedPaths.includes(i.path))));
  }

  const paths = items.flatMap((i) => (i.state === "done" && i.path ? [i.path] : []));
  const busy = items.some((i) => i.state === "compressing" || i.state === "uploading");
  const failed = items.filter((i) => i.state === "error").length;

  return { items, paths, busy, failed, notice, addFiles, retry, remove, reset, forget, maxPhotos };
}

export type PhotoUploads = ReturnType<typeof usePhotoUploads>;
