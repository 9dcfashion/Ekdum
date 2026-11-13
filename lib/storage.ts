import { env } from "@/lib/env";

export const BUCKETS = {
  logos: "logos",
  purchaseAttachments: "purchase-attachments",
  shipmentReceipts: "shipment-receipts",
  invoicePdfs: "invoice-pdfs",
} as const;

/** Public URL of a business logo (the `logos` bucket is public-read). */
export function logoUrl(path: string | null | undefined): string | null {
  if (!path || !env.supabaseUrl) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/${BUCKETS.logos}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Object paths always start with the business id, which the storage policies check. */
export function storagePath(businessId: string, folder: string, filename: string): string {
  const safe = filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-60);
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${businessId}/${folder}/${unique}-${safe || "file"}`;
}

export const UPLOAD_LIMITS = {
  logo: { maxBytes: 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
  purchaseAttachment: { maxBytes: 10 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "application/pdf"] },
  shipmentReceipt: { maxBytes: 5 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
} as const;
