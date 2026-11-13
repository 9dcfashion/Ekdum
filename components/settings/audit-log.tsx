import Link from "next/link";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterDate, FilterSelect, Pagination } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import type { AppContext } from "@/lib/auth/context";
import { addDays, formatDateTime } from "@/lib/dates";
import { PAGE_SIZE, pageParam, pageRange, param, type SearchParams } from "@/lib/list";
import {
  AUDIT_GROUPS,
  STAFF_AUDIT_GROUPS,
  auditActionLabel,
  auditEntityLabel,
  collectAuditIds,
  summariseChange,
} from "@/lib/settings/audit";
import type { AuditLogEntry } from "@/lib/types/db";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function namesFor(ctx: AppContext, table: string, column: string, ids: string[], scoped: boolean): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  let query = ctx.supabase.from(table).select(`id, ${column}`).in("id", ids);
  if (scoped) query = query.eq("business_id", ctx.business.id);
  const { data } = await query;
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

/**
 * The audit trail: who did what, when, and what changed.
 * `scope="staff"` limits it to staff and role changes (for people with staff.manage only).
 * Filters (`group`, `from`, `to`, `page`) live in the URL of `basePath`.
 */
export async function AuditLog({ ctx, sp, scope, basePath }: { ctx: AppContext; sp: SearchParams; scope: "all" | "staff"; basePath: string }) {
  const groups = AUDIT_GROUPS.filter((g) => scope === "all" || (STAFF_AUDIT_GROUPS as readonly string[]).includes(g.value));
  const group = groups.some((g) => g.value === param(sp, "group")) ? param(sp, "group") : "";
  const from = DATE.test(param(sp, "from")) ? param(sp, "from") : "";
  const to = DATE.test(param(sp, "to")) ? param(sp, "to") : "";
  const page = pageParam(sp);
  const [rangeFrom, rangeTo] = pageRange(page);

  let query = ctx.supabase
    .from("audit_log")
    .select("id, business_id, actor_id, action, entity, entity_id, before, after, created_at", { count: "exact" })
    .eq("business_id", ctx.business.id);
  if (group) query = query.like("action", `${group}.%`);
  else if (scope === "staff") query = query.or(STAFF_AUDIT_GROUPS.map((g) => `action.like.${g}.*`).join(","));
  // Dates are Indian calendar days.
  if (from) query = query.gte("created_at", `${from}T00:00:00+05:30`);
  if (to) query = query.lt("created_at", `${addDays(to, 1)}T00:00:00+05:30`);

  const { data, count, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(rangeFrom, rangeTo);
  const entries = (data ?? []) as AuditLogEntry[];
  const total = count ?? 0;

  // Names for the people, roles and outlets mentioned on this page.
  const payloadIds = collectAuditIds(entries);
  const memberIds = [...new Set(entries.filter((e) => e.entity === "business_members" && e.entity_id).map((e) => e.entity_id!))];
  const roleEntityIds = entries.filter((e) => e.entity === "roles" && e.entity_id).map((e) => e.entity_id!);
  const members = await namesFor(ctx, "business_members", "user_id", memberIds, true);
  const memberUser = new Map(members.map((m) => [m.id as string, m.user_id as string]));
  const profileIds = [...new Set([...entries.map((e) => e.actor_id).filter((id): id is string => !!id), ...payloadIds, ...memberUser.values()])];
  const [profiles, roles, outlets] = await Promise.all([
    namesFor(ctx, "profiles", "full_name, email", profileIds, false),
    namesFor(ctx, "roles", "name", [...new Set([...payloadIds, ...roleEntityIds])], true),
    namesFor(ctx, "outlets", "name", payloadIds, true),
  ]);
  const names: Record<string, string> = {};
  for (const p of profiles) names[p.id as string] = ((p.full_name as string) || "").trim() || (p.email as string) || "Someone";
  for (const r of roles) names[r.id as string] = r.name as string;
  for (const o of outlets) names[o.id as string] = o.name as string;

  function entityText(entry: AuditLogEntry): React.ReactNode {
    const label = auditEntityLabel(entry.entity);
    if (!entry.entity_id) return label;
    if (entry.entity === "business_members") {
      const userId = memberUser.get(entry.entity_id);
      return userId && names[userId] ? `${label}: ${names[userId]}` : label;
    }
    if (entry.entity === "roles") {
      const roleName = names[entry.entity_id] ?? (typeof entry.after?.role === "string" ? entry.after.role : null);
      return roleName ? `${label}: ${roleName}` : label;
    }
    if (entry.entity === "sales_invoices" && scope === "all") {
      return (
        <Link href={`/app/sales/${entry.entity_id}`} className="text-primary underline-offset-4 hover:underline">
          {label}
        </Link>
      );
    }
    return label;
  }

  const filtered = !!(group || from || to);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect param="group" label="Kind of action" options={[{ value: "", label: "All actions" }, ...groups.map((g) => ({ value: g.value, label: g.label }))]} />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>From</span>
          <FilterDate param="from" label="From date" />
          <span>to</span>
          <FilterDate param="to" label="To date" />
        </div>
      </div>

      {error ? (
        <EmptyState icon={ScrollText} title="Could not load the audit log" description="Please refresh the page. If this keeps happening, check your connection." />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? "Nothing matches these filters" : "Nothing recorded yet"}
          description={
            filtered
              ? "Try a wider date range or a different kind of action."
              : "Sensitive actions such as cancellations, stock adjustments and role changes are recorded here automatically."
          }
          action={
            filtered ? (
              <Button variant="outline" asChild>
                <Link href={basePath}>Clear filters</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What happened</th>
                <th className="px-3 py-2 font-medium">On</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="tabular px-3 py-2.5 whitespace-nowrap">{formatDateTime(entry.created_at)}</td>
                  <td className="px-3 py-2.5">{entry.actor_id ? (names[entry.actor_id] ?? "Former member") : "System"}</td>
                  <td className="px-3 py-2.5 font-medium">{auditActionLabel(entry.action)}</td>
                  <td className="px-3 py-2.5">{entityText(entry)}</td>
                  <td className="max-w-md px-3 py-2.5 text-xs break-words text-muted-foreground">
                    {summariseChange(entry.before, entry.after, names) || "No details"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
    </>
  );
}
