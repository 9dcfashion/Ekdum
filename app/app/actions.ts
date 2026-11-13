"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/actions";
import { BUSINESS_COOKIE, OUTLET_COOKIE, loadContext } from "@/lib/auth/context";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

/** Change the active business. The cookie is only a hint; membership is re-checked on every request. */
export async function switchBusinessAction(businessId: string): Promise<ActionResult> {
  const id = z.uuid().safeParse(businessId);
  const ctx = await loadContext();
  if (!ctx || !id.success) return fail("Not allowed");
  if (!ctx.memberships.some((m) => m.businessId === id.data)) return fail("You are not a member of that business");

  const cookieStore = await cookies();
  cookieStore.set(BUSINESS_COOKIE, id.data, COOKIE_OPTIONS);
  cookieStore.delete(OUTLET_COOKIE);
  revalidatePath("/app", "layout");
  return ok();
}

export async function switchOutletAction(outletId: string): Promise<ActionResult> {
  const id = z.uuid().safeParse(outletId);
  const ctx = await loadContext();
  if (!ctx || !id.success) return fail("Not allowed");
  if (!ctx.outlets.some((o) => o.id === id.data)) return fail("You do not have access to that outlet");

  const cookieStore = await cookies();
  cookieStore.set(OUTLET_COOKIE, id.data, COOKIE_OPTIONS);
  revalidatePath("/app", "layout");
  return ok();
}
