import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, type ServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { Business, Outlet, Profile, Role } from "@/lib/types/db";
import { can, type Permission } from "./permissions";

export const BUSINESS_COOKIE = "ekdum_business";
export const OUTLET_COOKIE = "ekdum_outlet";

export interface Membership {
  memberId: string;
  businessId: string;
  businessName: string;
  roleName: string;
  allOutlets: boolean;
  onboardingComplete: boolean;
}

export interface AppContext {
  supabase: ServerClient;
  user: { id: string; email: string };
  profile: Profile;
  memberships: Membership[];
  /** The active business (from the cookie, re-validated against membership on every request). */
  business: Business;
  role: Role;
  memberId: string;
  permissions: Set<string>;
  /** Active outlets of the business that this user may access. */
  outlets: Outlet[];
  /** The active outlet. Null only while onboarding (before the first outlet exists). */
  outlet: Outlet | null;
  can: (perm: Permission | readonly Permission[]) => boolean;
}

/** The signed-in user, verified with the Supabase Auth server. Null when signed out. */
export const getUser = cache(async () => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
});

interface MembershipRow {
  id: string;
  business_id: string;
  all_outlets: boolean;
  role: (Role & { role_permissions: { permission: string }[] }) | null;
  business: Business | null;
}

/**
 * Loads everything a request needs to know about "who is asking": the user,
 * their memberships, the active business and outlet, and their permissions.
 * The business/outlet cookies are only hints — both are checked against the
 * user's live memberships here, and RLS enforces the same thing in the database.
 * Returns null when signed out; `business` is undefined when the user has none yet.
 */
export const loadContext = cache(
  async (): Promise<(Omit<AppContext, "business" | "role" | "memberId"> & Partial<Pick<AppContext, "business" | "role" | "memberId">>) | null> => {
    const auth = await getUser();
    if (!auth) return null;
    const { supabase, user } = auth;

    const [{ data: profileRow }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, phone, email").eq("id", user.id).maybeSingle(),
      supabase
        .from("business_members")
        .select("id, business_id, all_outlets, role:roles(*, role_permissions(permission)), business:businesses(*)")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);
    if (memberError) throw new Error(`Could not load your account: ${memberError.message}`);

    const rows = ((memberRows ?? []) as unknown as MembershipRow[]).filter((r) => r.business && r.role);
    const memberships: Membership[] = rows.map((r) => ({
      memberId: r.id,
      businessId: r.business_id,
      businessName: r.business!.trade_name || r.business!.legal_name,
      roleName: r.role!.name,
      allOutlets: r.all_outlets,
      onboardingComplete: !!r.business!.onboarding_completed_at,
    }));

    const cookieStore = await cookies();
    const wantedBusiness = cookieStore.get(BUSINESS_COOKIE)?.value;
    const active = rows.find((r) => r.business_id === wantedBusiness) ?? rows[0];

    const profile: Profile = (profileRow as Profile | null) ?? {
      id: user.id,
      full_name: (user.user_metadata?.full_name as string) ?? "",
      phone: null,
      email: user.email ?? null,
    };

    const base = {
      supabase,
      user: { id: user.id, email: user.email ?? "" },
      profile,
      memberships,
    };

    if (!active) {
      return { ...base, permissions: new Set<string>(), outlets: [], outlet: null, can: () => false };
    }

    const permissions = new Set(active.role!.role_permissions.map((p) => p.permission));
    // RLS returns only the outlets this member may access.
    const { data: outletRows } = await supabase
      .from("outlets")
      .select("*")
      .eq("business_id", active.business_id)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    const outlets = (outletRows ?? []) as Outlet[];
    const wantedOutlet = cookieStore.get(OUTLET_COOKIE)?.value;
    const outlet = outlets.find((o) => o.id === wantedOutlet) ?? outlets[0] ?? null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { role_permissions, ...role } = active.role!;

    return {
      ...base,
      business: active.business!,
      role: role as Role,
      memberId: active.id,
      permissions,
      outlets,
      outlet,
      can: (perm) => can(permissions, perm),
    };
  },
);

/** For pages inside /app: signed in, has a business, onboarding finished. Redirects otherwise. */
export async function requireContext(): Promise<AppContext> {
  if (!isSupabaseConfigured()) redirect("/setup");
  const ctx = await loadContext();
  if (!ctx) redirect("/login");
  if (!ctx.business || !ctx.role || !ctx.memberId) redirect("/onboarding");
  if (!ctx.business.onboarding_completed_at) {
    // Staff of a business that is still being set up cannot finish it for the owner.
    redirect(ctx.permissions.has("settings.manage") ? "/onboarding" : "/app-pending");
  }
  return ctx as AppContext;
}

/** requireContext + a permission check. Sends the user to a "no access" page when it fails. */
export async function requirePage(perm: Permission | readonly Permission[]): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.can(perm)) redirect("/app/no-access");
  return ctx;
}

/** The first page in the app this user is allowed to open. */
export function homePathFor(ctx: Pick<AppContext, "can">): string {
  if (ctx.can("dashboard.view")) return "/app/dashboard";
  if (ctx.can("sales.create")) return "/app/pos";
  if (ctx.can("shipments.view")) return "/app/shipments";
  if (ctx.can(["sales.view_all", "sales.view_own"])) return "/app/sales";
  if (ctx.can("products.view")) return "/app/products";
  return "/app/no-access";
}
