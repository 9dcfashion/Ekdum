import Link from "next/link";
import { History, MailPlus, ShieldCheck, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { InviteDialog, type RoleOption } from "@/components/staff/invite-dialog";
import { InviteRowActions } from "@/components/staff/invite-row-actions";
import { MemberActions } from "@/components/staff/member-actions";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/dates";
import { PAGE_SIZE, pageParam, param, type SearchParams } from "@/lib/list";

export const metadata = { title: "Staff" };

interface MemberRow {
  id: string;
  user_id: string;
  role_id: string;
  is_active: boolean;
  all_outlets: boolean;
  last_active_at: string | null;
  created_at: string;
  member_outlets: { outlet_id: string }[] | null;
}

interface InviteRow {
  id: string;
  email: string;
  full_name: string | null;
  role_id: string;
  all_outlets: boolean;
  outlet_ids: string[] | null;
  expires_at: string;
  created_at: string;
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

function outletSummary(allOutlets: boolean, ids: string[], names: Map<string, string>): string {
  if (allOutlets) return "All outlets";
  if (ids.length === 0) return "No outlets";
  const known = ids.map((id) => names.get(id)).filter((n): n is string => !!n);
  const unknown = ids.length - known.length;
  return [...known, ...(unknown > 0 ? [`${unknown} other ${unknown === 1 ? "outlet" : "outlets"}`] : [])].join(", ");
}

export default async function StaffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePage("staff.manage");
  const sp = await searchParams;
  const q = param(sp, "q").toLowerCase();
  const status = param(sp, "status");
  const page = pageParam(sp);
  const viewerIsOwner = ctx.role.system_key === "owner";

  const [membersRes, rolesRes, outletsRes, invitesRes] = await Promise.all([
    ctx.supabase
      .from("business_members")
      .select("id, user_id, role_id, is_active, all_outlets, last_active_at, created_at, member_outlets(outlet_id)")
      .eq("business_id", ctx.business.id)
      .order("created_at", { ascending: true })
      .limit(2000),
    ctx.supabase.from("roles").select("id, name, system_key, is_system").eq("business_id", ctx.business.id).order("is_system", { ascending: false }).order("name"),
    ctx.supabase.from("outlets").select("id, name, is_active").eq("business_id", ctx.business.id).order("name"),
    // token_hash is deliberately not selected.
    ctx.supabase
      .from("invitations")
      .select("id, email, full_name, role_id, all_outlets, outlet_ids, expires_at, created_at")
      .eq("business_id", ctx.business.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const members = (membersRes.data ?? []) as unknown as MemberRow[];
  const roles = (rolesRes.data ?? []) as Array<RoleOption & { is_system: boolean }>;
  const outlets = (outletsRes.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  const invites = (invitesRes.data ?? []) as InviteRow[];

  // profiles cannot be embedded (user_id points at auth.users), so they are fetched separately.
  const profiles = new Map<string, { full_name: string; email: string | null }>();
  const userIds = members.map((m) => m.user_id);
  for (let i = 0; i < userIds.length; i += 200) {
    const { data } = await ctx.supabase.from("profiles").select("id, full_name, email").in("id", userIds.slice(i, i + 200));
    for (const p of (data ?? []) as Array<{ id: string; full_name: string; email: string | null }>) profiles.set(p.id, p);
  }

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const outletNames = new Map(outlets.map((o) => [o.id, o.name]));
  const activeOutlets = outlets.filter((o) => o.is_active).map((o) => ({ id: o.id, name: o.name }));
  const assignableRoles: RoleOption[] = roles
    .filter((r) => viewerIsOwner || r.system_key !== "owner")
    .map((r) => ({ id: r.id, name: r.name, system_key: r.system_key }));

  const rows = members.map((m) => {
    const profile = profiles.get(m.user_id);
    const role = roleById.get(m.role_id);
    return {
      id: m.id,
      name: profile?.full_name?.trim() || profile?.email || "Unnamed",
      email: profile?.email ?? "",
      roleId: m.role_id,
      roleName: role?.name ?? "Unknown role",
      isOwner: role?.system_key === "owner",
      isActive: m.is_active,
      isSelf: m.user_id === ctx.user.id,
      allOutlets: m.all_outlets,
      outletIds: (m.member_outlets ?? []).map((o) => o.outlet_id),
      lastActiveAt: m.last_active_at,
    };
  });

  const filtered = rows.filter((r) => {
    if (status === "active" && !r.isActive) return false;
    if (status === "inactive" && r.isActive) return false;
    if (q && !`${r.name} ${r.email} ${r.roleName}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Staff"
        description="People who can sign in to this business, what they can do and where."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/app/staff/audit">
                <History aria-hidden /> Audit trail
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/app/staff/roles">
                <ShieldCheck aria-hidden /> Roles
              </Link>
            </Button>
            <InviteDialog roles={assignableRoles} outlets={activeOutlets} />
          </>
        }
      />

      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="sr-only">
          Members
        </h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput placeholder="Search name, email or role" />
          <FilterSelect
            param="status"
            label="Status"
            options={[
              { value: "", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </div>

        {pageRows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={rows.length === 0 ? "No staff yet" : "No staff match these filters"}
            description={rows.length === 0 ? "Invite your first cashier or manager." : "Try a different search or status."}
            action={
              rows.length === 0 ? (
                <InviteDialog roles={assignableRoles} outlets={activeOutlets} />
              ) : (
                <Button variant="outline" asChild>
                  <Link href="/app/staff">Clear filters</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Outlet access</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last active</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((m) => (
                  <tr key={m.id} className={m.isActive ? undefined : "bg-muted/20 text-muted-foreground"}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{m.name}</p>
                      {m.email && m.email !== m.name ? <p className="text-xs text-muted-foreground">{m.email}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/app/staff/roles/${m.roleId}`} className="hover:underline">
                        {m.roleName}
                      </Link>
                    </td>
                    <td className="max-w-56 px-3 py-2.5">{outletSummary(m.allOutlets, m.outletIds, outletNames)}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge status={m.isActive ? "active" : "inactive"} />
                    </td>
                    <td className="tabular px-3 py-2.5 whitespace-nowrap">{m.lastActiveAt ? formatDateTime(m.lastActiveAt) : "Never"}</td>
                    <td className="px-3 py-2.5">
                      <MemberActions member={m} roles={assignableRoles} outlets={activeOutlets} viewerIsOwner={viewerIsOwner} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} />
      </section>

      <section aria-labelledby="invites-heading" className="mt-8">
        <h2 id="invites-heading" className="text-base font-semibold">
          Invites
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          People you have invited who have not joined yet. Resending creates a fresh link and switches the old one off.
        </p>
        {invites.length === 0 ? (
          <EmptyState
            icon={MailPlus}
            title="No pending invites"
            description="When you invite someone, they show up here until they accept."
            action={<InviteDialog roles={assignableRoles} outlets={activeOutlets} />}
            className="py-8"
          />
        ) : (
          <ul className="grid gap-2">
            {invites.map((invite) => {
              const expired = isExpired(invite.expires_at);
              return (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="truncate">{invite.full_name ? `${invite.full_name} (${invite.email})` : invite.email}</span>
                      <StatusBadge status={expired ? "expired" : "pending"} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {roleById.get(invite.role_id)?.name ?? "Unknown role"} ·{" "}
                      {outletSummary(invite.all_outlets, invite.outlet_ids ?? [], outletNames)} ·{" "}
                      {expired ? "Expired" : "Expires"} {formatDateTime(invite.expires_at)}
                    </p>
                  </div>
                  <InviteRowActions invitationId={invite.id} email={invite.email} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
