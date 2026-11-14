import { Zap } from "lucide-react";
import { QuickItemsManager, type PackOffer, type QuickItemRow } from "@/components/quick-items/quick-items-manager";
import { SettingsSection } from "@/components/settings/section";
import { EmptyState } from "@/components/shared/empty-state";
import { requirePage } from "@/lib/auth/context";
import { QUICK_ITEM_PACKS, missingFromPack } from "@/lib/quick-items/packs";

export const metadata = { title: "Quick billing items" };

export default async function QuickItemsPage() {
  const ctx = await requirePage(["settings.manage", "products.manage"]);
  const [itemsRes, ratesRes, unitsRes] = await Promise.all([
    ctx.supabase
      .from("quick_items")
      .select("id, name, gst_rate, hsn_code, unit_code, price_includes_tax, default_rate_paise, is_active")
      .eq("business_id", ctx.business.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    ctx.supabase.from("gst_rates").select("rate").eq("is_active", true).order("sort_order"),
    ctx.supabase.from("units").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  if (itemsRes.error) throw new Error(`Could not load quick items: ${itemsRes.error.message}`);
  const items = (itemsRes.data ?? []) as QuickItemRow[];
  const names = items.map((i) => i.name);
  const packs: PackOffer[] = QUICK_ITEM_PACKS.map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    missing: missingFromPack(p, names).length,
    total: p.items.length,
  }));

  return (
    <SettingsSection
      title="Quick billing items"
      description="Big buttons on the billing screen for things you sell often, such as Necklace or Finger Ring. Staff tap one and type only the rate and quantity: the GST rate, HSN and unit are already set. No stock is tracked for them."
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No quick items yet"
          description="Add a ready-made set below, or create your own."
          className="mb-4 py-8"
        />
      ) : null}
      <QuickItemsManager
        items={items}
        packs={packs}
        gstRates={((ratesRes.data ?? []) as Array<{ rate: number }>).map((r) => Number(r.rate))}
        units={(unitsRes.data ?? []) as Array<{ code: string; name: string }>}
        chargesTax={ctx.business.gst_scheme === "regular"}
      />
    </SettingsSection>
  );
}
