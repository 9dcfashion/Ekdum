import { FileText, ImageIcon, X } from "lucide-react";

/** "…/bills/lx3k2-ab12cd-my-bill.jpg" → "my-bill.jpg". */
export function attachmentName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/^[a-z0-9]+-[a-z0-9]+-/, "") || file;
}

const isPdf = (path: string) => /\.pdf$/i.test(path);

/**
 * One attached bill photo or PDF. Opens in a new tab through a signed URL.
 * Without a URL (expired or not readable) it still shows the file name.
 */
export function AttachmentTile({ path, url, onRemove }: { path: string; url?: string; onRemove?: () => void }) {
  const name = attachmentName(path);
  const preview = (
    <span
      className="flex size-20 items-center justify-center overflow-hidden rounded-lg border bg-muted bg-cover bg-center"
      style={url && !isPdf(path) ? { backgroundImage: `url("${url}")` } : undefined}
      aria-hidden
    >
      {isPdf(path) ? (
        <FileText className="size-7 text-muted-foreground" />
      ) : url ? null : (
        <ImageIcon className="size-7 text-muted-foreground" />
      )}
    </span>
  );
  return (
    <li className="relative w-20">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-lg focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" title={`Open ${name}`}>
          {preview}
          <span className="mt-1 block truncate text-xs text-muted-foreground">{name}</span>
        </a>
      ) : (
        <>
          {preview}
          <span className="mt-1 block truncate text-xs text-muted-foreground">{name}</span>
        </>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </li>
  );
}
