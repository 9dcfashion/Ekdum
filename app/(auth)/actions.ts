"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/actions";
import { BUSINESS_COOKIE, OUTLET_COOKIE } from "@/lib/auth/context";
import { absoluteUrl, isSupabaseConfigured } from "@/lib/env";
import { rateLimit, rateLimitByIp } from "@/lib/rate-limit";
import { hashInviteToken, loadInvite } from "@/lib/staff/invites";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  acceptInviteSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

const NOT_CONFIGURED = "The app is not connected to Supabase yet. Add the keys to .env.local and restart.";
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

function firstIssue(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".") || "_form"] ??= []).push(issue.message);
  return fail(error.issues[0]?.message ?? "Please check the form", fieldErrors);
}

/** Only allow redirects back into this app (no open redirects). */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/app";
  return next;
}

export async function signInAction(input: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  // Per IP and per account, so one address cannot be hammered from many IPs either.
  if (!(await rateLimitByIp("auth:signin:ip", 20, 600)) || !(await rateLimit(`auth:signin:${parsed.data.email}`, 10, 600))) {
    return fail(TOO_MANY);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (/not confirmed/i.test(error.message)) {
      return fail("Please verify your email first. Check your inbox for the confirmation link.");
    }
    return fail("Incorrect email or password");
  }
  return ok({ redirectTo: safeNext(parsed.data.next) });
}

export async function signUpAction(input: unknown): Promise<ActionResult<{ needsVerification: boolean }>> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  if (!(await rateLimitByIp("auth:signup:ip", 10, 3600))) return fail(TOO_MANY);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: absoluteUrl("/auth/confirm?next=/onboarding"),
      data: { full_name: parsed.data.full_name, phone: parsed.data.phone ?? "" },
    },
  });
  if (error) {
    if (/already registered|already been registered/i.test(error.message)) {
      return fail("An account with this email already exists. Try signing in.");
    }
    if (/rate limit/i.test(error.message)) return fail(TOO_MANY);
    if (/password/i.test(error.message)) return fail(error.message);
    return fail("Could not create your account. Please try again.");
  }
  // With "Confirm email" on, Supabase returns a user but no session until the link is clicked.
  return ok({ needsVerification: !data.session });
}

export async function forgotPasswordAction(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  if (!(await rateLimitByIp("auth:forgot:ip", 5, 3600))) return fail(TOO_MANY);

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: absoluteUrl("/auth/confirm?next=/reset-password"),
  });
  // Always the same answer, so this form cannot be used to discover who has an account.
  return ok();
}

export async function resetPasswordAction(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("This reset link has expired. Please request a new one.");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(/same|different/i.test(error.message) ? "Choose a password you have not used before" : "Could not update your password");
  return ok();
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const cookieStore = await cookies();
  cookieStore.delete(BUSINESS_COOKIE);
  cookieStore.delete(OUTLET_COOKIE);
  redirect("/login");
}

/**
 * New staff member: create the account (the invite token proves they own the
 * email, so it is marked verified), attach the membership, and sign them in.
 */
export async function acceptInviteNewUserAction(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const parsed = acceptInviteSchema.safeParse(input);
  if (!parsed.success) return firstIssue(parsed.error);
  if (!(await rateLimitByIp("auth:invite:ip", 10, 3600))) return fail(TOO_MANY);

  const { invite, reason } = await loadInvite(parsed.data.token);
  if (!invite) return fail(reason ?? "This invite link is not valid.");

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: invite.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });
  if (createError || !created.user) {
    if (/already|exists|registered/i.test(createError?.message ?? "")) {
      return fail("An account with this email already exists. Sign in to accept the invite.");
    }
    return fail("Could not create your account. Please try again.");
  }

  const { error: acceptError } = await admin.rpc("accept_invitation", {
    p_token_hash: hashInviteToken(parsed.data.token),
    p_user: created.user.id,
  });
  if (acceptError) {
    // Do not leave an orphan account behind if the invite could not be attached.
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(acceptError.message);
  }

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: invite.email, password: parsed.data.password });
  return ok();
}

/** Existing user, already signed in with the invited email. */
export async function acceptInviteExistingUserAction(token: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return fail(NOT_CONFIGURED);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Please sign in first.");
  const { invite, reason } = await loadInvite(token);
  if (!invite) return fail(reason ?? "This invite link is not valid.");
  if (auth.user.email?.toLowerCase() !== invite.email) {
    return fail(`This invite was sent to ${invite.email}. Sign in with that email to accept it.`);
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("accept_invitation", { p_token_hash: hashInviteToken(token), p_user: auth.user.id });
  if (error) return fail(error.message);
  return ok();
}
