"use client";

import { useRef, useState } from "react";
import { Camera, FileText, ImageIcon, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compressPhoto } from "@/lib/images";
import { BUCKETS, UPLOAD_LIMITS, storagePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { MAX_ATTACHMENTS } from "@/lib/validation/purchases";
import { attachmentName } from "./attachment-tile";

const LIMIT = UPLOAD_LIMITS.purchaseAttachment;
const MAX_MB = Math.round(LIMIT.maxBytes / (1024 * 1024));
const allowed = (type: string) => (LIMIT.types as readonly string[]).includes(type);
const isPdf = (path: string) => /\.pdf$/i.test(path);

/**
 * Shrink photos (HEIC and other image types become JPEG where the browser can
 * read them), upload each file to the private bucket and sign a preview URL.
 * Problems are shown as toasts; files that fail are skipped.
 */
async function uploadBillFiles(
  businessId: string,
  files: File[],
  onProgress: (done: number) => void,
): Promise<{ added: string[]; addedUrls: Record<string, string> }> {
  const bucket = createClient().storage.from(BUCKETS.purchaseAttachments);
  const added: string[] = [];
  const addedUrls: Record<string, string> = {};
  try {
    for (const [i, original] of files.entries()) {
      const file = original.type.startsWith("image/") ? await compressPhoto(original, { maxSizeMB: 1, maxDimension: 2000 }) : original;
      if (!allowed(file.type)) {
        toast.error(`${original.name}: only photos (JPG, PNG, WebP) and PDFs can be added`);
        continue;
      }
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
      onProgress(i + 1);
    }
  } catch {
    toast.error("Upload failed. Check your internet and try again.");
  }
  return { added, addedUrls };
}

/**
 * Photos and PDFs of the supplier's bill, phone first: a big "Take photo"
 * button opens the camera, "Choose file" opens photos or files. Photos are
 * shrunk in the browser, then go straight to the private `purchase-attachments`
 * bucket; the form only keeps their paths. Removing a page only takes it off the
 * draft: the stored file is deleted by the server when the draft is saved.
 */
export function AttachmentsField({
  businessId,
  paths,
  onChange,
  urls,
  onUrls,
  onBusyChange,
}: {
  businessId: string;
  paths: string[];
  onChange: (paths: string[]) => void;
  /** Signed URLs by path, for previews. */
  urls: Record<string, string>;
  onUrls: (added: Record<string, string>) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = paths.length >= MAX_ATTACHMENTS;

  async function addFiles(files: File[]) {
    const room = MAX_ATTACHMENTS - paths.length;
    if (room <= 0) {
      toast.error(`You can add up to ${MAX_ATTACHMENTS} pages`);
      return;
    }
    if (files.length > room) toast.error(`Only the first ${room} file${room === 1 ? "" : "s"} will be added`);
    const batch = files.slice(0, room);

    setUploading({ done: 0, total: batch.length });
    onBusyChange?.(true);
    const { added, addedUrls } = await uploadBillFiles(businessId, batch, (done) => setUploading({ done, total: batch.length }));
    setUploading(null);
    onBusyChange?.(false);
    if (added.length > 0) {
      onUrls(addedUrls);
      onChange([...paths, ...added]);
    }
  }

  function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void addFiles(files);
  }

  const busy = uploading !== null;

  return (
    <div>
      {/* Two inputs: one asks for the back camera, one opens the gallery or files (several at once). */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={picked} />
      <input ref={fileRef} type="file" multiple accept={LIMIT.types.join(",")} className="sr-only" tabIndex={-1} aria-hidden onChange={picked} />

      {paths.length > 0 || busy ? (
        <ul className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-3" aria-label="Pages of the bill">
          {paths.map((path, i) => (
            <PageTile key={path} path={path} url={urls[path]} label={`Page ${i + 1}`} onRemove={() => onChange(paths.filter((p) => p !== path))} />
          ))}
          {busy ? (
            <li className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <span role="status">
                Uploading {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className={cn("grid gap-3", paths.length > 0 && "grid-cols-2 lg:grid-cols-1")}>
        <Button
          type="button"
          className={cn("text-base lg:hidden", paths.length > 0 ? "h-12" : "h-16")}
          disabled={busy || full}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-5" aria-hidden />
          {paths.length > 0 ? "Add page" : "Take photo"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className={cn("text-base lg:h-10", paths.length > 0 ? "h-12" : "h-14")}
          disabled={busy || full}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip className="size-5" aria-hidden />
          <span className="lg:hidden">Choose file</span>
          <span className="hidden lg:inline">{paths.length > 0 ? "Add another page" : "Attach photo or PDF"}</span>
        </Button>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Photos or PDF, up to {MAX_MB} MB each. A bill with more pages? Add each page.
      </p>

      {/* Phase 2 seam: an AI reader will turn the photo into a DraftPrefill (lib/purchases/prefill.ts). */}
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
        <Sparkles className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Scan with AI: fills the bill from the photo</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Coming soon</span>
      </div>
    </div>
  );
}

function PageTile({ path, url, label, onRemove }: { path: string; url?: string; label: string; onRemove: () => void }) {
  const name = attachmentName(path);
  const preview = (
    <span
      className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-xl border bg-muted bg-cover bg-center"
      style={url && !isPdf(path) ? { backgroundImage: `url("${url}")` } : undefined}
      aria-hidden
    >
      {isPdf(path) ? <FileText className="size-8 text-muted-foreground" /> : url ? null : <ImageIcon className="size-8 text-muted-foreground" />}
    </span>
  );
  return (
    <li className="relative min-w-0">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" title={`Open ${name}`}>
          {preview}
        </a>
      ) : (
        preview
      )}
      <span className="mt-1 block truncate text-center text-xs text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label.toLowerCase()}`}
        className="absolute -top-2 -right-2 flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden />
      </button>
    </li>
  );
}

/** Small row of bill pages, so whoever types the details can look at the paper. Opens each page in a new tab. */
export function PhotoStrip({ paths, urls, className }: { paths: string[]; urls: Record<string, string>; className?: string }) {
  if (paths.length === 0) return null;
  return (
    <div className={cn("flex items-center gap-3 overflow-x-auto rounded-xl border bg-muted/30 p-2", className)}>
      <span className="shrink-0 pl-1 text-sm text-muted-foreground">Bill photo</span>
      {paths.map((path, i) =>
        urls[path] ? (
          <a
            key={path}
            href={urls[path]}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open page ${i + 1} of the bill`}
            className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted bg-cover bg-center focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            style={isPdf(path) ? undefined : { backgroundImage: `url("${urls[path]}")` }}
          >
            {isPdf(path) ? <FileText className="size-5 text-muted-foreground" aria-hidden /> : null}
          </a>
        ) : (
          <span key={path} className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted" aria-label={`Page ${i + 1}`}>
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          </span>
        ),
      )}
    </div>
  );
}
