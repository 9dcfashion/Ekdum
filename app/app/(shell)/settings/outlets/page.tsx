import { OutletsManager, type OutletRow } from "@/components/settings/outlets-manager";
import { InfoBox, SettingsSection } from "@/components/settings/section";
import { requirePage } from "@/lib/auth/context";
import { financialYear } from "@/lib/dates";

export const metadata = { title: "Outlets" };

export default async function OutletsPage() {
  const ctx = await requirePage("settings.manage");
  const b = ctx.business;
  const fy = financialYear();

  const [outletsRes, seriesRes] = await Promise.all([
    ctx.supabase
      .from("outlets")
      .select("id, name, address_line1, address_line2, city, pincode, state_code, gstin, phone, is_active")
      .eq("business_id", b.id)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("invoice_series")
      .select("outlet_id, pos_device_id, document_type, prefix, financial_year, is_active")
      .eq("business_id", b.id),
  ]);

  const series = (seriesRes.data ?? []) as Array<{
    outlet_id: string;
    pos_device_id: string | null;
    document_type: string;
    prefix: string;
    financial_year: string;
    is_active: boolean;
  }>;
  const outlets: OutletRow[] = ((outletsRes.data ?? []) as Array<Omit<OutletRow, "invoicePrefix">>).map((o) => ({
    ...o,
    invoicePrefix:
      series.find(
        (s) => s.outlet_id === o.id && !s.pos_device_id && s.document_type === "invoice" && s.financial_year === fy && s.is_active,
      )?.prefix ?? null,
  }));

  return (
    <SettingsSection title="Outlets" description="Your shops and branches. Each outlet has its own stock, bill numbers and staff access.">
      <OutletsManager
        outlets={outlets}
        business={{ registered: b.gst_scheme !== "unregistered", gstin: b.gstin, state_code: b.state_code, city: b.city, phone: b.phone }}
        usedPrefixes={[...new Set(series.map((s) => s.prefix))]}
        fy={fy}
      />
      <InfoBox className="mt-5">
        <ul>
          <li>An outlet that has bills or stock cannot be deleted, so its records stay complete. Switch it off instead.</li>
          <li>Give staff access to a new outlet under Staff. People with access to all outlets get it automatically.</li>
          <li>An outlet in another state needs its own GSTIN, and its bills are numbered separately.</li>
        </ul>
      </InfoBox>
    </SettingsSection>
  );
}
