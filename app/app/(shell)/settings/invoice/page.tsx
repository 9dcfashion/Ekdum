import Link from "next/link";
import { InvoicePrefsForm } from "@/components/settings/invoice-prefs-form";
import { SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";
import { loadPreviewBusiness } from "@/lib/settings/preview";

export const metadata = { title: "Invoice settings" };

export default async function InvoiceSettingsPage() {
  const ctx = await requirePage("settings.manage");
  const b = ctx.business;
  const preview = await loadPreviewBusiness(ctx);

  return (
    <SettingsSection
      title="Invoice settings"
      description={
        <>
          What is printed on bills and the rules around them. Bill numbers are under{" "}
          <Link href="/app/settings/series" className="text-primary underline-offset-4 hover:underline">
            Invoice series
          </Link>
          .
        </>
      }
    >
      <InvoicePrefsForm
        prefs={{
          default_print_format: b.default_print_format,
          round_off_enabled: b.round_off_enabled,
          invoice_terms: b.invoice_terms,
          invoice_footer: b.invoice_footer,
          hsn_digits: b.hsn_digits,
          bos_for_exempt_only: b.bos_for_exempt_only,
          cancel_window_days: b.cancel_window_days,
          allow_negative_stock: b.allow_negative_stock,
          stuck_shipment_days: b.stuck_shipment_days,
        }}
        preview={preview}
        logoPath={b.logo_path}
        brandColor={b.brand_color}
        chargesTax={b.gst_scheme === "regular"}
      />
    </SettingsSection>
  );
}
