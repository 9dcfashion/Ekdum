import Link from "next/link";
import { MonitorSmartphone } from "lucide-react";
import { RegisterThisDevice } from "@/components/pos/register-device";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination } from "@/components/shared/list-controls";
import { StatusBadge } from "@/components/shared/status-badge";
import { DeviceActions } from "@/components/settings/device-actions";
import { InfoBox, SettingsSection } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { financialYear, formatDateTime } from "@/lib/dates";
import { PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";

export const metadata = { title: "POS devices" };

interface DeviceRow {
  id: string;
  outlet_id: string;
  name: string;
  last_seen_at: string | null;
  is_active: boolean;
  created_at: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

export default async function DevicesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("settings.manage");
  const sp = await searchParams;
  const outletFilter = UUID.test(param(sp, "outlet")) ? param(sp, "outlet") : "";
  const statusFilter = ["active", "inactive"].includes(param(sp, "status")) ? param(sp, "status") : "";
  const page = pageParam(sp);
  const [from, to] = pageRange(page);
  const fy = financialYear();

  // device_key_hash is deliberately not selected.
  let query = ctx.supabase
    .from("pos_devices")
    .select("id, outlet_id, name, last_seen_at, is_active, created_at", { count: "exact" })
    .eq("business_id", ctx.business.id);
  if (outletFilter) query = query.eq("outlet_id", outletFilter);
  if (statusFilter) query = query.eq("is_active", statusFilter === "active");

  const [devicesRes, seriesRes, outletsRes] = await Promise.all([
    query.order("is_active", { ascending: false }).order("created_at", { ascending: false }).range(from, to),
    ctx.supabase
      .from("invoice_series")
      .select("pos_device_id, prefix, financial_year, next_number")
      .eq("business_id", ctx.business.id)
      .limit(5000),
    ctx.supabase.from("outlets").select("id, name").eq("business_id", ctx.business.id).order("name"),
  ]);

  const devices = (devicesRes.data ?? []) as DeviceRow[];
  const total = devicesRes.count ?? 0;
  const series = (seriesRes.data ?? []) as Array<{ pos_device_id: string | null; prefix: string; financial_year: string; next_number: number }>;
  const outlets = (outletsRes.data ?? []) as Array<{ id: string; name: string }>;
  const outletNames = new Map(outlets.map((o) => [o.id, o.name]));
  const usedPrefixes = [...new Set(series.map((s) => s.prefix))];
  /** A device's series for this year, or its most recent one. */
  const seriesFor = (deviceId: string) => {
    const own = series.filter((s) => s.pos_device_id === deviceId).sort((a, b) => b.financial_year.localeCompare(a.financial_year));
    return own.find((s) => s.financial_year === fy) ?? own[0] ?? null;
  };
  const filtered = !!(outletFilter || statusFilter);

  return (
    <SettingsSection
      title="POS devices"
      description="The computers and tablets you bill from. Registering a device lets it keep billing when the internet is down."
    >
      <RegisterThisDevice outlets={ctx.outlets.map((o) => ({ id: o.id, name: o.name }))} usedPrefixes={usedPrefixes} />

      <InfoBox title="Why does each device have its own number series?" className="my-4">
        <ul>
          <li>
            When the internet drops, a registered counter keeps making bills and numbers them itself from its own series (for
            example C1/…), so two counters can never issue the same bill number.
          </li>
          <li>The bills are sent to the server when the connection returns. Nothing is lost and nothing is renumbered.</li>
          <li>A device that is not registered can still bill online. It uses the outlet&apos;s own series and needs the internet.</li>
          <li>Register each billing counter once, from that counter&apos;s own browser.</li>
        </ul>
      </InfoBox>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect param="outlet" label="Outlet" options={[{ value: "", label: "All outlets" }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]} />
        <FilterSelect
          param="status"
          label="Status"
          options={[
            { value: "", label: "Any status" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </div>

      {devices.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphone}
          title={filtered ? "No devices match these filters" : "No POS devices registered yet"}
          description={
            filtered
              ? "Try different filters."
              : "Open this page on the computer or tablet at your billing counter and register it, so it can bill offline."
          }
          action={
            filtered ? (
              <Button variant="outline" asChild>
                <Link href="/app/settings/devices">Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Device</th>
                <th className="px-3 py-2 font-medium">Outlet</th>
                <th className="px-3 py-2 font-medium">Series prefix</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {devices.map((d) => {
                const own = seriesFor(d.id);
                return (
                  <tr key={d.id} className={d.is_active ? undefined : "bg-muted/20 text-muted-foreground"}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{d.name}</p>
                      <p className="text-xs text-muted-foreground">Registered {formatDateTime(d.created_at)}</p>
                    </td>
                    <td className="px-3 py-2.5">{outletNames.get(d.outlet_id) ?? "Another outlet"}</td>
                    <td className="tabular px-3 py-2.5 font-medium">{own?.prefix ?? "None"}</td>
                    <td className="tabular px-3 py-2.5 whitespace-nowrap">{d.last_seen_at ? formatDateTime(d.last_seen_at) : "Never"}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={d.is_active ? "active" : "inactive"} />
                    </td>
                    <td className="px-3 py-2.5">
                      <DeviceActions device={{ id: d.id, name: d.name, is_active: d.is_active }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </SettingsSection>
  );
}
