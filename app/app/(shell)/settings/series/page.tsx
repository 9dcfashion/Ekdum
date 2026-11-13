import Link from "next/link";
import { Hash } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination } from "@/components/shared/list-controls";
import { StatusBadge } from "@/components/shared/status-badge";
import { InfoBox, SettingsSection } from "@/components/settings/section";
import { AddSeriesDialog, SeriesActions, type ActiveServerSeries } from "@/components/settings/series-manager";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { financialYear, financialYearLabel } from "@/lib/dates";
import { PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import { sampleNumber } from "@/lib/settings/series";

export const metadata = { title: "Invoice series" };

interface SeriesRow {
  id: string;
  outlet_id: string;
  pos_device_id: string | null;
  document_type: "invoice" | "credit_note";
  prefix: string;
  financial_year: string;
  next_number: number;
  is_active: boolean;
}

const UUID = /^[0-9a-f-]{36}$/i;

export default async function SeriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("settings.manage");
  const sp = await searchParams;
  const fy = financialYear();
  const outletFilter = UUID.test(param(sp, "outlet")) ? param(sp, "outlet") : "";
  const typeFilter = ["invoice", "credit_note"].includes(param(sp, "type")) ? param(sp, "type") : "";
  const yearFilter = /^\d{4}$/.test(param(sp, "year")) ? param(sp, "year") : "";
  const statusFilter = ["active", "inactive"].includes(param(sp, "status")) ? param(sp, "status") : "";
  const page = pageParam(sp);
  const [from, to] = pageRange(page);

  let query = ctx.supabase
    .from("invoice_series")
    .select("id, outlet_id, pos_device_id, document_type, prefix, financial_year, next_number, is_active", { count: "exact" })
    .eq("business_id", ctx.business.id);
  if (outletFilter) query = query.eq("outlet_id", outletFilter);
  if (typeFilter) query = query.eq("document_type", typeFilter);
  if (yearFilter) query = query.eq("financial_year", yearFilter);
  if (statusFilter) query = query.eq("is_active", statusFilter === "active");

  const [listRes, allRes, outletsRes, devicesRes] = await Promise.all([
    query
      .order("financial_year", { ascending: false })
      .order("is_active", { ascending: false })
      .order("prefix", { ascending: true })
      .range(from, to),
    // Every prefix and year of the business: for uniqueness checks and the filters.
    ctx.supabase
      .from("invoice_series")
      .select("outlet_id, pos_device_id, document_type, prefix, financial_year, is_active")
      .eq("business_id", ctx.business.id)
      .limit(5000),
    ctx.supabase.from("outlets").select("id, name, is_active").eq("business_id", ctx.business.id).order("name"),
    ctx.supabase.from("pos_devices").select("id, name").eq("business_id", ctx.business.id),
  ]);

  const rows = (listRes.data ?? []) as SeriesRow[];
  const total = listRes.count ?? 0;
  const all = (allRes.data ?? []) as Array<Omit<SeriesRow, "id" | "next_number">>;
  const outlets = (outletsRes.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  const outletNames = new Map(outlets.map((o) => [o.id, o.name]));
  const deviceNames = new Map(((devicesRes.data ?? []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]));
  const usedPrefixes = [...new Set(all.map((s) => s.prefix))];
  const years = [...new Set([fy, ...all.map((s) => s.financial_year)])].sort().reverse();
  const activeServer: ActiveServerSeries[] = all
    .filter((s) => !s.pos_device_id && s.is_active && s.financial_year === fy)
    .map((s) => ({ outlet_id: s.outlet_id, document_type: s.document_type, prefix: s.prefix }));
  const filtered = !!(outletFilter || typeFilter || yearFilter || statusFilter);

  return (
    <SettingsSection
      title="Invoice series"
      description="The running numbers on your bills and credit notes. Each outlet, and each POS device, has its own."
      actions={
        <AddSeriesDialog
          outlets={outlets.filter((o) => o.is_active).map((o) => ({ id: o.id, name: o.name }))}
          usedPrefixes={usedPrefixes}
          activeServer={activeServer}
          fy={fy}
        />
      }
    >
      <InfoBox className="mb-4">
        <ul>
          <li>
            A number looks like <span className="tabular font-medium text-foreground">PREFIX/YEAR/NUMBER</span>, for example{" "}
            <span className="tabular font-medium text-foreground">{sampleNumber("A", fy, 42)}</span>.
          </li>
          <li>
            GST rules allow at most 16 characters in a bill number, using only letters, digits, hyphen and slash. That is why a
            prefix can be at most 4 characters.
          </li>
          <li>Numbers restart from 1 every 1 April, automatically. They never go backwards and are never reused.</li>
          <li>To change a prefix that is already in use, add a new series for the outlet. The old one is switched off.</li>
        </ul>
      </InfoBox>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect param="outlet" label="Outlet" options={[{ value: "", label: "All outlets" }, ...outlets.map((o) => ({ value: o.id, label: o.name }))]} />
        <FilterSelect
          param="type"
          label="Type"
          options={[
            { value: "", label: "All types" },
            { value: "invoice", label: "Invoices" },
            { value: "credit_note", label: "Credit notes" },
          ]}
        />
        <FilterSelect param="year" label="Financial year" options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: y, label: financialYearLabel(y) }))]} />
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

      {rows.length === 0 ? (
        <EmptyState
          icon={Hash}
          title={filtered ? "No series match these filters" : "No number series yet"}
          description={filtered ? "Try different filters." : "Add a series so your outlet can issue bills."}
          action={
            filtered ? (
              <Button variant="outline" asChild>
                <Link href="/app/settings/series">Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Outlet</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Issued by</th>
                <th className="px-3 py-2 font-medium">Prefix</th>
                <th className="px-3 py-2 font-medium">Year</th>
                <th className="px-3 py-2 text-right font-medium">Next number</th>
                <th className="px-3 py-2 font-medium">Next bill will be</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((s) => {
                const nextNumber = Number(s.next_number);
                const outletName = outletNames.get(s.outlet_id) ?? "Another outlet";
                return (
                  <tr key={s.id} className={s.is_active ? undefined : "bg-muted/20 text-muted-foreground"}>
                    <td className="px-3 py-2.5">{outletName}</td>
                    <td className="px-3 py-2.5">{s.document_type === "invoice" ? "Invoices" : "Credit notes"}</td>
                    <td className="px-3 py-2.5">
                      {s.pos_device_id ? (deviceNames.get(s.pos_device_id) ?? "POS device") : "Server"}
                      {s.pos_device_id ? <span className="block text-xs text-muted-foreground">POS device</span> : null}
                    </td>
                    <td className="tabular px-3 py-2.5 font-medium">{s.prefix}</td>
                    <td className="tabular px-3 py-2.5">{financialYearLabel(s.financial_year)}</td>
                    <td className="tabular px-3 py-2.5 text-right">{nextNumber}</td>
                    <td className="tabular px-3 py-2.5">{sampleNumber(s.prefix, s.financial_year, nextNumber) ?? "Number too long"}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={s.is_active ? "active" : "inactive"} label={s.is_active ? "Active" : "Off"} />
                    </td>
                    <td className="px-3 py-2.5">
                      {s.pos_device_id ? (
                        <Link href="/app/settings/devices" className="block text-right text-xs text-primary underline-offset-4 hover:underline">
                          Managed under POS devices
                        </Link>
                      ) : (
                        <SeriesActions
                          series={{
                            id: s.id,
                            prefix: s.prefix,
                            financial_year: s.financial_year,
                            next_number: nextNumber,
                            is_active: s.is_active,
                            document_type: s.document_type,
                            outletName,
                          }}
                          usedPrefixes={usedPrefixes}
                          isCurrentYear={s.financial_year === fy}
                        />
                      )}
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
