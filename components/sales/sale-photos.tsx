import { Camera } from "lucide-react";
import type { AppContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/dates";
import { BUCKETS, UPLOAD_LIMITS } from "@/lib/storage";
import type { SalesInvoicePhoto } from "@/lib/types/db";
import { AddSalePhotos, RemoveSalePhoto } from "./sale-photos-client";

/**
 * Photos of the goods handed over on a bill. Visible to whoever can see the bill
 * (RLS); anyone who can bill may add more to a posted bill; owners and managers may remove.
 */
export async function SalePhotos({
  ctx,
  invoiceId,
  cancelled,
}: {
  ctx: AppContext;
  invoiceId: string;
  cancelled: boolean;
}) {
  const { data, error } = await ctx.supabase
    .from("sales_invoice_photos")
    .select("id, business_id, invoice_id, storage_path, created_by, created_at")
    .eq("invoice_id", invoiceId)
    .eq("business_id", ctx.business.id)
    .order("created_at", { ascending: true });
  const photos = (data ?? []) as SalesInvoicePhoto[];
  const canAdd = !cancelled && ctx.can("sales.create") && photos.length < UPLOAD_LIMITS.salePhoto.maxPerBill;

  // Nothing to show and nothing the user can do: keep the page uncluttered.
  if (!error && photos.length === 0 && !canAdd) return null;

  const signed = photos.length
    ? ((await ctx.supabase.storage.from(BUCKETS.salePhotos).createSignedUrls(photos.map((p) => p.storage_path), 3600)).data ?? [])
    : [];
  const urlOf = new Map(signed.filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));

  const peopleIds = [...new Set(photos.map((p) => p.created_by).filter((v): v is string => !!v))];
  const { data: people } = peopleIds.length ? await ctx.supabase.from("profiles").select("id, full_name, email").in("id", peopleIds) : { data: [] };
  const nameOf = (id: string | null) => {
    const p = ((people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).find((x) => x.id === id);
    return p ? p.full_name || p.email || "Staff" : "Staff";
  };
  const canRemove = ctx.can("sales.cancel");

  return (
    <section className="rounded-xl border p-4" aria-label="Photos of items given">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Camera className="size-4 text-muted-foreground" aria-hidden /> Photos of items given
        <span className="font-normal text-muted-foreground">({photos.length})</span>
      </h2>
      {error ? <p className="mt-2 text-sm text-destructive">Could not load the photos.</p> : null}

      {photos.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((photo) => {
            const url = urlOf.get(photo.storage_path);
            return (
              <li key={photo.id} className="min-w-0">
                <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open photo added by ${nameOf(photo.created_by)}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Items given, photo added by ${nameOf(photo.created_by)}`} className="size-full object-cover" loading="lazy" />
                    </a>
                  ) : (
                    <span className="flex size-full items-center justify-center px-2 text-center text-xs text-muted-foreground">Photo unavailable</span>
                  )}
                  {canRemove ? (
                    <span className="absolute top-1 right-1 rounded-md bg-background/90">
                      <RemoveSalePhoto photoId={photo.id} />
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={`${nameOf(photo.created_by)}, ${formatDateTime(photo.created_at)}`}>
                  {nameOf(photo.created_by)} · {formatDateTime(photo.created_at)}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No photos yet. Add one to keep a record of what was handed over.</p>
      )}

      {canAdd ? (
        <div className="mt-3">
          <AddSalePhotos businessId={ctx.business.id} invoiceId={invoiceId} existingCount={photos.length} />
        </div>
      ) : null}
    </section>
  );
}
