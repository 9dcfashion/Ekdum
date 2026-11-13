import { BusinessForm } from "@/components/settings/business-form";
import { SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";

export const metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const ctx = await requirePage("settings.manage");
  const b = ctx.business;

  return (
    <SettingsSection title="Business profile" description="Your legal details. They are printed at the top of every bill.">
      <BusinessForm
        key={`${b.gst_scheme}:${b.gstin ?? ""}`}
        business={{
          legal_name: b.legal_name,
          trade_name: b.trade_name,
          gst_scheme: b.gst_scheme,
          gstin: b.gstin,
          pan: b.pan,
          state_code: b.state_code,
          address_line1: b.address_line1,
          address_line2: b.address_line2,
          city: b.city,
          pincode: b.pincode,
          phone: b.phone,
          email: b.email,
        }}
      />
    </SettingsSection>
  );
}
