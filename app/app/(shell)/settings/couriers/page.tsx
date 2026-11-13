import Link from "next/link";
import { Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { StatusBadge } from "@/components/shared/status-badge";
import { CourierRowActions, CourierToolbar, type CourierRow } from "@/components/settings/couriers-manager";
import { SettingsSection } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { PAGE_SIZE, ilikeTerm, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { COMMON_COURIERS } from "@/lib/settings/nav";

export const metadata = { title: "Courier partners" };

export default async function CouriersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("settings.manage");
  const sp = await searchParams;
  const q = ilikeTerm(param(sp, "q"));
  const statusFilter = ["active", "inactive"].includes(param(sp, "status")) ? param(sp, "status") : "";
  const page = pageParam(sp);
  const [from, to] = pageRange(page);

  let query = ctx.supabase
    .from("courier_partners")
    .select("id, name, tracking_url_template, is_active", { count: "exact" })
    .eq("business_id", ctx.business.id);
  if (q) query = query.ilike("name", `%${q}%`);
  if (statusFilter) query = query.eq("is_active", statusFilter === "active");

  const [listRes, namesRes] = await Promise.all([
    query.order("is_active", { ascending: false }).order("name").range(from, to),
    ctx.supabase.from("courier_partners").select("name").eq("business_id", ctx.business.id).limit(2000),
  ]);
  const couriers = (listRes.data ?? []) as CourierRow[];
  const total = listRes.count ?? 0;
  const existing = new Set(((namesRes.data ?? []) as Array<{ name: string }>).map((c) => c.name.trim().toLowerCase()));
  const missingCommon = COMMON_COURIERS.filter((name) => !existing.has(name.toLowerCase()));
  const filtered = !!(q || statusFilter);

  return (
    <SettingsSection
      title="Courier partners"
      description="The couriers you send parcels with. A tracking link lets staff and customers open the courier's tracking page in one tap."
      actions={<CourierToolbar missingCommon={[...missingCommon]} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput placeholder="Search couriers" />
        <FilterSelect
          param="status"
          label="Status"
          options={[
            { value: "", label: "Any status" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Switched off" },
          ]}
        />
      </div>

      {couriers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={filtered ? "No couriers match" : "No couriers yet"}
          description={
            filtered ? "Try a different search." : "Add the couriers you use so staff can pick one when they log a shipment."
          }
          action={
            filtered ? (
              <Button variant="outline" asChild>
                <Link href="/app/settings/couriers">Clear filters</Link>
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <CourierToolbar missingCommon={[...missingCommon]} />
              </div>
            )
          }
        />
      ) : (
        <ul className="grid gap-2">
          {couriers.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {c.name}
                  <StatusBadge status={c.is_active ? "active" : "inactive"} label={c.is_active ? "Active" : "Off"} />
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.tracking_url_template ?? "No tracking link yet. Edit to add one."}
                </p>
              </div>
              <CourierRowActions courier={c} />
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </SettingsSection>
  );
}
