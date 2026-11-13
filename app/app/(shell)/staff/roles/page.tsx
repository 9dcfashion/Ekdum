import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { NewRoleDialog } from "@/components/staff/new-role-dialog";
import { requirePage } from "@/lib/auth/context";

export const metadata = { title: "Roles" };

interface RoleRow {
  id: string;
  name: string;
  is_system: boolean;
  system_key: string | null;
  max_discount_percent: number;
  role_permissions: { permission: string }[] | null;
}

const SYSTEM_ORDER = ["owner", "manager", "cashier", "dispatch"];

export default async function RolesPage() {
  const ctx = await requirePage("staff.manage");

  const [rolesRes, membersRes, permissionsRes] = await Promise.all([
    ctx.supabase
      .from("roles")
      .select("id, name, is_system, system_key, max_discount_percent, role_permissions(permission)")
      .eq("business_id", ctx.business.id)
      .order("name"),
    ctx.supabase.from("business_members").select("role_id, is_active").eq("business_id", ctx.business.id).limit(5000),
    ctx.supabase.from("permissions").select("key", { count: "exact", head: true }),
  ]);

  const roles = ((rolesRes.data ?? []) as unknown as RoleRow[]).sort((a, b) => {
    if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
    if (a.is_system) return SYSTEM_ORDER.indexOf(a.system_key ?? "") - SYSTEM_ORDER.indexOf(b.system_key ?? "");
    return a.name.localeCompare(b.name);
  });
  const counts = new Map<string, number>();
  for (const m of (membersRes.data ?? []) as Array<{ role_id: string }>) counts.set(m.role_id, (counts.get(m.role_id) ?? 0) + 1);
  const totalPermissions = permissionsRes.count ?? 0;

  return (
    <>
      <PageHeader
        title="Roles"
        description="A role is a set of permissions. Built-in roles are fixed; create your own for anything else."
        backHref="/app/staff"
        actions={<NewRoleDialog roles={roles.map((r) => ({ id: r.id, name: r.name }))} />}
      />

      <ul className="grid gap-2">
        {roles.map((role) => {
          const members = counts.get(role.id) ?? 0;
          const granted = role.role_permissions?.length ?? 0;
          return (
            <li key={role.id}>
              <Link
                href={`/app/staff/roles/${role.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3 text-sm transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {role.name}
                    {role.is_system ? (
                      <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        <Lock className="size-3" aria-hidden /> Built-in
                      </span>
                    ) : (
                      <span className="rounded-full border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">Custom</span>
                    )}
                  </p>
                  <p className="tabular mt-0.5 text-xs text-muted-foreground">
                    {members} {members === 1 ? "member" : "members"} · {granted} of {totalPermissions} permissions · discount up to{" "}
                    {Number(role.max_discount_percent)}%
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
