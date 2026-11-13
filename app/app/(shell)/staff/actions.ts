"use server";

import { revalidatePath } from "next/cache";
import { ActionError, describeDbError, runAction, unwrap } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { getEmailProvider } from "@/lib/providers";
import { createInvitation } from "@/lib/staff/invites";
import {
  invitationIdSchema,
  memberActiveSchema,
  memberOutletsSchema,
  memberRoleSchema,
  roleCreateSchema,
  roleIdSchema,
  roleSaveSchema,
  staffInviteSchema,
} from "@/lib/validation/staff";

const STAFF = { perm: "staff.manage" } as const;

interface InviteResult {
  email: string;
  acceptUrl: string;
  /** False when the email provider reported a failure. */
  emailed: boolean;
  /** True when no real email provider is configured (emails are only printed to the server log). */
  testMode: boolean;
}

async function sendInvite(
  ctx: AppContext,
  input: { email: string; full_name: string | null; role_id: string; all_outlets: boolean; outlet_ids: string[] },
): Promise<InviteResult> {
  if (input.email === ctx.user.email.toLowerCase()) throw new ActionError("That is your own email address");

  // Only outlets of this business that the inviter can see.
  let outletIds: string[] = [];
  if (!input.all_outlets) {
    const { data } = await ctx.supabase.from("outlets").select("id").eq("business_id", ctx.business.id).in("id", input.outlet_ids);
    outletIds = ((data ?? []) as Array<{ id: string }>).map((o) => o.id);
    if (outletIds.length === 0) throw new ActionError("Choose at least one outlet", { outlet_ids: ["Choose at least one outlet"] });
  }

  const result = await createInvitation(ctx, { ...input, outlet_ids: outletIds });
  return {
    email: input.email,
    acceptUrl: result.acceptUrl,
    emailed: result.emailed,
    testMode: getEmailProvider().name === "mock",
  };
}

export async function inviteStaffAction(input: unknown) {
  return runAction(staffInviteSchema, input, STAFF, async (data, ctx) => {
    const result = await sendInvite(ctx, data);
    revalidatePath("/app/staff");
    return result;
  });
}

/** Sends a fresh link. createInvitation() revokes the earlier pending invite for the same email. */
export async function resendInviteAction(input: unknown) {
  return runAction(invitationIdSchema, input, STAFF, async ({ invitation_id }, ctx) => {
    const { data: invite } = await ctx.supabase
      .from("invitations")
      .select("id, email, full_name, role_id, all_outlets, outlet_ids, accepted_at")
      .eq("id", invitation_id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!invite) throw new ActionError("This invite no longer exists");
    if (invite.accepted_at) throw new ActionError("This invite has already been accepted");

    const result = await sendInvite(ctx, {
      email: invite.email as string,
      full_name: (invite.full_name as string | null) ?? null,
      role_id: invite.role_id as string,
      all_outlets: invite.all_outlets as boolean,
      outlet_ids: (invite.outlet_ids as string[] | null) ?? [],
    });
    revalidatePath("/app/staff");
    return result;
  });
}

export async function revokeInviteAction(input: unknown) {
  return runAction(invitationIdSchema, input, STAFF, async ({ invitation_id }, ctx) => {
    const rows = unwrap(
      await ctx.supabase
        .from("invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", invitation_id)
        .eq("business_id", ctx.business.id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .select("id"),
    );
    if (!rows || rows.length === 0) throw new ActionError("This invite was already used or cancelled");
    revalidatePath("/app/staff");
  });
}

async function loadMember(ctx: AppContext, memberId: string) {
  const { data } = await ctx.supabase
    .from("business_members")
    .select("id, user_id, role_id, is_active, role:roles(system_key)")
    .eq("id", memberId)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!data) throw new ActionError("This staff member was not found");
  const row = data as unknown as {
    id: string;
    user_id: string;
    role_id: string;
    is_active: boolean;
    role: { system_key: string | null } | { system_key: string | null }[] | null;
  };
  const role = Array.isArray(row.role) ? row.role[0] : row.role;
  return { id: row.id, user_id: row.user_id, role_id: row.role_id, is_active: row.is_active, isOwner: role?.system_key === "owner" };
}

/** A manager who can manage staff still cannot demote or switch off an owner. */
function assertMayChange(ctx: AppContext, member: { isOwner: boolean }) {
  if (member.isOwner && ctx.role.system_key !== "owner") {
    throw new ActionError("Only an owner can change another owner");
  }
}

/**
 * The database guards do the real work here and their messages are shown as they are:
 * only an Owner can assign the Owner role, and the last active Owner cannot be demoted.
 */
export async function changeMemberRoleAction(input: unknown) {
  return runAction(memberRoleSchema, input, STAFF, async ({ member_id, role_id }, ctx) => {
    const member = await loadMember(ctx, member_id);
    if (member.user_id === ctx.user.id) {
      throw new ActionError("You cannot change your own role. Ask another owner to do it.");
    }
    assertMayChange(ctx, member);
    const { data: role } = await ctx.supabase
      .from("roles")
      .select("id, system_key")
      .eq("id", role_id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!role) throw new ActionError("Select a role");
    if (role.system_key === "owner" && ctx.role.system_key !== "owner") {
      throw new ActionError("Only an owner can assign the Owner role");
    }
    if (member.role_id !== role_id) {
      unwrap(await ctx.supabase.from("business_members").update({ role_id }).eq("id", member_id).eq("business_id", ctx.business.id));
    }
    revalidatePath("/app/staff");
  });
}

export async function setMemberOutletsAction(input: unknown) {
  return runAction(memberOutletsSchema, input, STAFF, async (data, ctx) => {
    await loadMember(ctx, data.member_id);
    unwrap(
      await ctx.supabase.rpc("set_member_outlets", {
        p_member_id: data.member_id,
        p_all_outlets: data.all_outlets,
        p_outlet_ids: data.all_outlets ? [] : data.outlet_ids,
      }),
    );
    revalidatePath("/app/staff");
  });
}

/** Deactivating takes effect on the person's very next request (RLS checks is_active). */
export async function setMemberActiveAction(input: unknown) {
  return runAction(memberActiveSchema, input, STAFF, async ({ member_id, is_active }, ctx) => {
    const member = await loadMember(ctx, member_id);
    if (member.user_id === ctx.user.id && !is_active) throw new ActionError("You cannot deactivate yourself");
    assertMayChange(ctx, member);
    unwrap(await ctx.supabase.from("business_members").update({ is_active }).eq("id", member_id).eq("business_id", ctx.business.id));
    revalidatePath("/app/staff");
  });
}

// ── Roles ───────────────────────────────────────────────────────────────────

async function validPermissionKeys(ctx: AppContext): Promise<Set<string>> {
  const { data, error } = await ctx.supabase.from("permissions").select("key");
  if (error) throw new ActionError(describeDbError(error));
  return new Set(((data ?? []) as Array<{ key: string }>).map((p) => p.key));
}

export async function createRoleAction(input: unknown) {
  return runAction(roleCreateSchema, input, STAFF, async ({ name, copy_from }, ctx) => {
    type Source = { id: string; max_discount_percent: number; system_key: string | null };
    let source = null as Source | null;
    if (copy_from) {
      const { data } = await ctx.supabase
        .from("roles")
        .select("id, max_discount_percent, system_key")
        .eq("id", copy_from)
        .eq("business_id", ctx.business.id)
        .maybeSingle();
      if (!data) throw new ActionError("The role to copy from was not found");
      source = data as Source;
    }

    const role = unwrap(
      await ctx.supabase
        .from("roles")
        .insert({ business_id: ctx.business.id, name, max_discount_percent: Number(source?.max_discount_percent ?? 0) })
        .select("id")
        .single(),
    ) as { id: string };

    if (source) {
      const { data: perms } = await ctx.supabase.from("role_permissions").select("permission").eq("role_id", source.id);
      const rows = ((perms ?? []) as Array<{ permission: string }>).map((p) => ({ role_id: role.id, permission: p.permission }));
      if (rows.length > 0) {
        const { error } = await ctx.supabase.from("role_permissions").insert(rows);
        if (error) {
          revalidatePath("/app/staff/roles");
          throw new ActionError(`The role was created, but its permissions could not be copied: ${describeDbError(error)}`);
        }
      }
    }
    revalidatePath("/app/staff/roles");
    return role;
  });
}

/**
 * Saves a role. Custom roles: name, discount limit and permissions (as a diff
 * against what is stored). System roles: only the discount limit, and not for Owner.
 */
export async function saveRoleAction(input: unknown) {
  return runAction(roleSaveSchema, input, STAFF, async (data, ctx) => {
    const { data: role } = await ctx.supabase
      .from("roles")
      .select("id, name, is_system, system_key, max_discount_percent")
      .eq("id", data.role_id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!role) throw new ActionError("This role was not found");

    if (role.is_system) {
      if (role.system_key === "owner") throw new ActionError("The Owner role cannot be changed");
      if (Number(role.max_discount_percent) !== data.max_discount_percent) {
        unwrap(await ctx.supabase.from("roles").update({ max_discount_percent: data.max_discount_percent }).eq("id", role.id));
      }
    } else {
      const known = await validPermissionKeys(ctx);
      const wanted = new Set(data.permissions);
      for (const key of wanted) if (!known.has(key)) throw new ActionError("One of the permissions is not valid. Reload the page and try again.");

      // You can lock yourself out of this page by removing staff.manage from your own role.
      if (role.id === ctx.role.id && !wanted.has("staff.manage")) {
        throw new ActionError("This is your own role. You cannot remove “Manage staff, roles and invites” from it.");
      }

      unwrap(
        await ctx.supabase.from("roles").update({ name: data.name, max_discount_percent: data.max_discount_percent }).eq("id", role.id),
      );

      const { data: currentRows, error } = await ctx.supabase.from("role_permissions").select("permission").eq("role_id", role.id);
      if (error) throw new ActionError(describeDbError(error));
      const current = new Set(((currentRows ?? []) as Array<{ permission: string }>).map((p) => p.permission));
      const toAdd = [...wanted].filter((p) => !current.has(p));
      const toRemove = [...current].filter((p) => !wanted.has(p));

      if (toAdd.length > 0) {
        unwrap(await ctx.supabase.from("role_permissions").insert(toAdd.map((permission) => ({ role_id: role.id, permission }))));
      }
      if (toRemove.length > 0) {
        unwrap(await ctx.supabase.from("role_permissions").delete().eq("role_id", role.id).in("permission", toRemove));
      }
    }
    revalidatePath("/app/staff/roles");
    revalidatePath(`/app/staff/roles/${role.id}`);
    // Permissions drive the whole shell (navigation, buttons).
    revalidatePath("/app", "layout");
  });
}

export async function deleteRoleAction(input: unknown) {
  return runAction(roleIdSchema, input, STAFF, async ({ role_id }, ctx) => {
    const { data: role } = await ctx.supabase
      .from("roles")
      .select("id, is_system")
      .eq("id", role_id)
      .eq("business_id", ctx.business.id)
      .maybeSingle();
    if (!role) throw new ActionError("This role was not found");
    if (role.is_system) throw new ActionError("System roles cannot be deleted");

    const { count } = await ctx.supabase
      .from("business_members")
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.business.id)
      .eq("role_id", role_id);
    if (count && count > 0) {
      throw new ActionError(
        `${count} staff ${count === 1 ? "member has" : "members have"} this role. Give them another role first, then delete it.`,
      );
    }

    const { error } = await ctx.supabase.from("roles").delete().eq("id", role_id).eq("business_id", ctx.business.id);
    if (error) {
      // FK restrict from business_members (someone was given the role in the meantime).
      if (error.code === "23503") throw new ActionError("Staff members still have this role. Give them another role first.");
      throw new ActionError(describeDbError(error));
    }
    revalidatePath("/app/staff/roles");
  });
}
