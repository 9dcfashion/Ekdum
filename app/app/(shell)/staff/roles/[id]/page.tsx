import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { RoleEditor, type PermissionOption } from "@/components/staff/role-editor";
import { requirePage } from "@/lib/auth/context";

export const metadata = { title: "Role" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("staff.manage");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const [roleRes, permissionsRes, grantedRes, membersRes] = await Promise.all([
    ctx.supabase
      .from("roles")
      .select("id, name, is_system, system_key, max_discount_percent")
      .eq("id", id)
      .eq("business_id", ctx.business.id)
      .maybeSingle(),
    // The list of permissions always comes from the database, never from code.
    ctx.supabase.from("permissions").select("key, group_name, label, sort_order").order("sort_order").order("key"),
    ctx.supabase.from("role_permissions").select("permission").eq("role_id", id),
    ctx.supabase.from("business_members").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id).eq("role_id", id),
  ]);

  const role = roleRes.data as {
    id: string;
    name: string;
    is_system: boolean;
    system_key: string | null;
    max_discount_percent: number;
  } | null;
  if (!role) notFound();

  const permissions = (permissionsRes.data ?? []) as PermissionOption[];
  const granted = ((grantedRes.data ?? []) as Array<{ permission: string }>).map((p) => p.permission);

  return (
    <>
      <PageHeader
        title={role.name}
        description={role.is_system ? "Built-in role" : "Custom role"}
        backHref="/app/staff/roles"
      />
      <RoleEditor
        key={`${role.id}:${granted.slice().sort().join(",")}:${role.name}:${role.max_discount_percent}`}
        role={{ ...role, max_discount_percent: Number(role.max_discount_percent) }}
        permissions={permissions}
        granted={granted}
        memberCount={membersRes.count ?? 0}
      />
    </>
  );
}
