"use client";

import imageCompression from "browser-image-compression";

/**
 * Centre-crop an image to a square and resize it. Always returns a PNG:
 * the invoice PDF can embed PNG and JPEG logos but not WebP.
 */
export async function cropToSquare(file: File, size = 512): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();

  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not process the image");
  return new File([png], "logo.png", { type: "image/png" });
}

/** Shrink a photo before upload (phone cameras produce 4–12 MB files). */
export async function compressPhoto(file: File, opts: { maxSizeMB?: number; maxDimension?: number } = {}): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: opts.maxSizeMB ?? 0.6,
      maxWidthOrHeight: opts.maxDimension ?? 1600,
      useWebWorker: true,
      fileType: "image/jpeg",
      initialQuality: 0.8,
    });
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([compressed], name, { type: "image/jpeg" });
  } catch {
    return file; // better to upload the original than to fail
  }
}
