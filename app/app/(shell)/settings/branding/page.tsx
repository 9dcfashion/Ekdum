import { BrandingForm } from "@/components/settings/branding-form";
import { SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";
import { loadPreviewBusiness } from "@/lib/settings/preview";

export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const ctx = await requirePage("settings.manage");
  const preview = await loadPreviewBusiness(ctx);

  return (
    <SettingsSection title="Branding" description="Your logo and colour on invoices, receipts and the bill page customers open.">
      <BrandingForm
        key={`${ctx.business.logo_path ?? ""}:${ctx.business.brand_color}`}
        business={preview}
        initialLogoPath={ctx.business.logo_path}
        initialColor={ctx.business.brand_color}
      />
    </SettingsSection>
  );
}
