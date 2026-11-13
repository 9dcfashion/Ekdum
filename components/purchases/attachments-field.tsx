"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compressPhoto } from "@/lib/images";
import { BUCKETS, UPLOAD_LIMITS, storagePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/browser";
import { MAX_ATTACHMENTS } from "@/lib/validation/purchases";
import { AttachmentTile } from "./attachment-tile";

const LIMIT = UPLOAD_LIMITS.purchaseAttachment;
const MAX_MB = Math.round(LIMIT.maxBytes / (1024 * 1024));

/**
 * Photos and PDFs of the vendor's bill. Files go straight from the browser to
 * the private `purchase-attachments` bucket; the form only keeps their paths.
 * Removing a tile only takes it off the draft: the stored file is deleted by
 * the server when the draft is saved, so a discarded edit loses nothing.
 */
export function AttachmentsField({
  businessId,
  paths,
  onChange,
  initialUrls,
  onBusyChange,
}: {
  businessId: string;
  paths: string[];
  onChange: (paths: string[]) => void;
  initialUrls: Record<string, string>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>(initialUrls);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    const room = MAX_ATTACHMENTS - paths.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files`);
      return;
    }
    if (files.length > room) toast.error(`Only the first ${room} file${room === 1 ? "" : "s"} will be attached`);

    setUploading(true);
    onBusyChange?.(true);
    const supabase = createClient();
    const bucket = supabase.storage.from(BUCKETS.purchaseAttachments);
    const added: string[] = [];
    const addedUrls: Record<string, string> = {};
    try {
      for (const original of files.slice(0, room)) {
        if (!(LIMIT.types as readonly string[]).includes(original.type)) {
          toast.error(`${original.name}: only JPG, PNG, WebP photos and PDFs can be attached`);
          continue;
        }
        const file = await compressPhoto(original, { maxSizeMB: 1, maxDimension: 2000 });
        if (file.size > LIMIT.maxBytes) {
          toast.error(`${original.name} is larger than ${MAX_MB} MB`);
          continue;
        }
        const path = storagePath(businessId, "bills", file.name);
        const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
        if (error) {
          toast.error(`${original.name} could not be uploaded. Please try again.`);
          continue;
        }
        added.push(path);
        const { data } = await bucket.createSignedUrl(path, 3600);
        if (data?.signedUrl) addedUrls[path] = data.signedUrl;
      }
    } catch {
      toast.error("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
      onBusyChange?.(false);
    }
    if (added.length > 0) {
      setUrls((current) => ({ ...current, ...addedUrls }));
      onChange([...paths, ...added]);
    }
  }

  return (
    <div>
      {paths.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-3">
          {paths.map((path) => (
            <AttachmentTile key={path} path={path} url={urls[path]} onRemove={() => onChange(paths.filter((p) => p !== path))} />
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={LIMIT.types.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-label="Attach bill photos or PDFs"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) void addFiles(files);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={uploading || paths.length >= MAX_ATTACHMENTS} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="animate-spin" aria-hidden /> : <Paperclip aria-hidden />}
          {uploading ? "Uploading" : paths.length > 0 ? "Attach another" : "Attach bill photo or PDF"}
        </Button>
        {/* Phase 2 seam: an AI reader will turn an attachment into a DraftPrefill (lib/purchases/prefill.ts). */}
        <Button type="button" variant="ghost" disabled title="Coming soon">
          <Sparkles aria-hidden /> Scan with AI (coming soon)
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        JPG, PNG, WebP or PDF, up to {MAX_MB} MB each. In a hurry? Attach the bill, save the draft and fill in the rest later.
      </p>
    </div>
  );
}
