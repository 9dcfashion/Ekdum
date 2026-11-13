"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MiniInvoicePreview } from "@/components/invoice/mini-preview";
import { Field } from "@/components/shared/field";
import { Button } from "@/components/ui/button";
import { resolveDocumentType } from "@/lib/gst";
import { cropToSquare } from "@/lib/images";
import { BUCKETS, UPLOAD_LIMITS, logoUrl as publicLogoUrl, storagePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/browser";
import { useAction } from "@/lib/use-action";
import { cn } from "@/lib/utils";
import { saveBrandingAction } from "../actions";
import type { WizardData } from "../wizard";
import { StepFooter, useGoToStep } from "./shared";

const SWATCHES = ["#4338CA", "#0F766E", "#B45309", "#BE123C", "#1D4ED8", "#15803D", "#7E22CE", "#111827"];

export function BrandingStep({ data }: { data: WizardData }) {
  const business = data.business!;
  const goTo = useGoToStep();
  const { run, pending } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(business.brand_color);
  const [logoPath, setLogoPath] = useState<string | null>(business.logo_path);
  const [uploading, setUploading] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file (PNG, JPG or WebP)");
      return;
    }
    setUploading(true);
    try {
      // Cropped to a square and resized in the browser, so uploads stay small.
      const cropped = await cropToSquare(file, 512);
      if (cropped.size > UPLOAD_LIMITS.logo.maxBytes) throw new Error("That image is too large. Try a smaller one.");
      const path = storagePath(business.id, "logo", cropped.name);
      const { error } = await createClient().storage.from(BUCKETS.logos).upload(path, cropped, {
        contentType: cropped.type,
        cacheControl: "31536000",
      });
      if (error) throw new Error(error.message);
      setLogoPath(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the logo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const address = [business.address_line1, business.city].filter(Boolean).join(", ");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveBrandingAction({ logo_path: logoPath, brand_color: color }), { onSuccess: () => goTo(3) });
      }}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="grid content-start gap-6">
          <Field label="Logo" hint="Square works best. It is cropped to a square and compressed automatically.">
            <div className="flex items-center gap-3">
              <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                {uploading ? (
                  <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Uploading" />
                ) : logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={publicLogoUrl(logoPath) ?? ""} alt="Your logo" className="size-full object-cover" />
                ) : (
                  <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  id="logo-file"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {logoPath ? "Change logo" : "Upload logo"}
                </Button>
                {logoPath ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLogoPath(null)}>
                    <Trash2 aria-hidden /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </Field>

          <Field label="Brand colour" hint="Used for headings and lines on your invoice.">
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  aria-label={`Use colour ${swatch}`}
                  aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
                  className={cn(
                    "size-8 rounded-full border-2 border-white outline-none ring-1 ring-border transition-transform focus-visible:ring-2 focus-visible:ring-ring",
                    color.toLowerCase() === swatch.toLowerCase() && "scale-110 ring-2 ring-foreground",
                  )}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <label className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs text-muted-foreground">
                Custom
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  className="size-6 cursor-pointer border-0 bg-transparent p-0"
                  aria-label="Pick a custom colour"
                />
              </label>
            </div>
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Live preview</p>
          <MiniInvoicePreview
            name={business.trade_name || business.legal_name}
            address={address}
            gstin={business.gstin}
            stateCode={business.state_code}
            logoUrl={publicLogoUrl(logoPath)}
            brandColor={color}
            documentType={resolveDocumentType({ scheme: business.gst_scheme, lineGstRates: [18], bosForExemptOnly: true })}
            footer={business.invoice_footer}
          />
        </div>
      </div>
      <StepFooter step={2} pending={pending || uploading} />
    </form>
  );
}
