import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { render } from "@react-email/components";
import { InviteEmail, inviteEmailText } from "@/emails/invite";
import { ActionError, describeDbError } from "@/lib/actions";
import type { AppContext } from "@/lib/auth/context";
import { absoluteUrl } from "@/lib/env";
import { getEmailProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";

export const INVITE_EXPIRY_DAYS = 7;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface InviteInput {
  email: string;
  full_name: string | null;
  role_id: string;
  all_outlets: boolean;
  outlet_ids: string[];
}

/**
 * Creates an invitation row (under RLS: needs staff.manage) and emails the link.
 * Only the SHA-256 of the token is stored; the link itself is returned once so
 * the owner can also share it on WhatsApp.
 */
export async function createInvitation(
  ctx: AppContext,
  input: InviteInput,
): Promise<{ id: string; acceptUrl: string; emailed: boolean }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: role } = await ctx.supabase
    .from("roles")
    .select("id, name, business_id")
    .eq("id", input.role_id)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (!role) throw new ActionError("Select a role");

  // profiles is readable only for people who already share a business with the caller.
  const { data: knownProfile } = await ctx.supabase.from("profiles").select("id").eq("email", input.email).maybeSingle();
  if (knownProfile) {
    const { data: existing } = await ctx.supabase
      .from("business_members")
      .select("id, is_active")
      .eq("business_id", ctx.business.id)
      .eq("user_id", knownProfile.id)
      .maybeSingle();
    if (existing?.is_active) throw new ActionError("This person is already a member of your business");
  }

  // Replace any earlier pending invite for the same email.
  await ctx.supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("business_id", ctx.business.id)
    .eq("email", input.email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { data, error } = await ctx.supabase
    .from("invitations")
    .insert({
      business_id: ctx.business.id,
      email: input.email,
      full_name: input.full_name,
      role_id: input.role_id,
      all_outlets: input.all_outlets,
      outlet_ids: input.all_outlets ? [] : input.outlet_ids,
      token_hash: hashInviteToken(token),
      expires_at: expiresAt,
      invited_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) throw new ActionError(describeDbError(error));

  const acceptUrl = absoluteUrl(`/accept-invite?token=${token}`);
  const props = {
    businessName: ctx.business.trade_name || ctx.business.legal_name,
    inviterName: ctx.profile.full_name || ctx.user.email,
    inviteeName: input.full_name,
    roleName: role.name as string,
    acceptUrl,
    expiresInDays: INVITE_EXPIRY_DAYS,
  };
  const result = await getEmailProvider().send({
    to: input.email,
    subject: `${props.inviterName} invited you to ${props.businessName} on EkDum`,
    html: await render(InviteEmail(props)),
    text: inviteEmailText(props),
  });

  return { id: data.id as string, acceptUrl, emailed: result.ok };
}

export interface InvitePreview {
  email: string;
  fullName: string | null;
  businessName: string;
  roleName: string;
}

/** Look an invite up by its token. Server only; returns nothing identifying for bad tokens. */
export async function loadInvite(token: string): Promise<{ invite: InvitePreview | null; reason?: string }> {
  if (!token || token.length < 20) return { invite: null, reason: "This invite link is not valid." };
  const admin = createAdminClient();
  const { data } = await admin
    .from("invitations")
    .select("email, full_name, expires_at, accepted_at, revoked_at, role:roles(name), business:businesses(legal_name, trade_name)")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!data) return { invite: null, reason: "This invite link is not valid." };
  if (data.revoked_at) return { invite: null, reason: "This invite has been cancelled. Ask the owner to send a new one." };
  if (data.accepted_at) return { invite: null, reason: "This invite has already been used. Try signing in." };
  if (new Date(data.expires_at as string) < new Date()) {
    return { invite: null, reason: "This invite has expired. Ask the owner to send a new one." };
  }
  const business = data.business as unknown as { legal_name: string; trade_name: string | null } | null;
  const role = data.role as unknown as { name: string } | null;
  return {
    invite: {
      email: data.email as string,
      fullName: (data.full_name as string | null) ?? null,
      businessName: business?.trade_name || business?.legal_name || "the business",
      roleName: role?.name ?? "Staff",
    },
  };
}

