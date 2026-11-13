import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo, PoweredBy } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { loadContext } from "@/lib/auth/context";
import { financialYear } from "@/lib/dates";
import { isSupabaseConfigured } from "@/lib/env";
import { logoUrl } from "@/lib/storage";
import type { GstRate, Role, Unit } from "@/lib/types/db";
import { TOTAL_STEPS } from "@/lib/validation/onboarding";
import { OnboardingWizard, type WizardData } from "./wizard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Set up your shop" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string; new?: string }> }) {
  if (!isSupabaseConfigured()) redirect("/setup");
  const ctx = await loadContext();
  if (!ctx) redirect("/login?next=/onboarding");
  const sp = await searchParams;

  // "Add another business" from the switcher starts a fresh wizard.
  const createNew = sp.new === "1" && (!ctx.business || !!ctx.business.onboarding_completed_at);
  const business = createNew ? undefined : ctx.business;

  if (business?.onboarding_completed_at) redirect("/app");
  if (business && !ctx.permissions.has("settings.manage")) redirect("/app-pending");

  const savedStep = business ? Math.min(Math.max(business.onboarding_step, 2), TOTAL_STEPS) : 1;
  const requested = Number.parseInt(sp.step ?? "", 10);
  const step = Number.isFinite(requested) && requested >= 1 && requested <= savedStep ? requested : savedStep;

  let data: WizardData = {
    createNew,
    step,
    savedStep,
    userEmail: ctx.user.email,
    business: null,
    logoUrl: null,
    outlet: null,
    series: null,
    roles: [],
    gstRates: [],
    units: [],
    invites: [],
    products: [],
  };

  if (business) {
    const outlet = ctx.outlets[0] ?? null;
    const [roles, gstRates, units, invites, products, series] = await Promise.all([
      ctx.supabase.from("roles").select("id, name, system_key").eq("business_id", business.id).order("created_at"),
      ctx.supabase.from("gst_rates").select("*").eq("is_active", true).order("sort_order"),
      ctx.supabase.from("units").select("*").eq("is_active", true).order("sort_order"),
      ctx.supabase
        .from("invitations")
        .select("id, email")
        .eq("business_id", business.id)
        .is("accepted_at", null)
        .is("revoked_at", null),
      ctx.supabase.from("products").select("id, name").eq("business_id", business.id).order("created_at").limit(50),
      outlet
        ? ctx.supabase
            .from("invoice_series")
            .select("prefix, next_number")
            .eq("outlet_id", outlet.id)
            .eq("document_type", "invoice")
            .is("pos_device_id", null)
            .eq("financial_year", financialYear())
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    data = {
      ...data,
      business,
      logoUrl: logoUrl(business.logo_path),
      outlet,
      series: series.data ? { prefix: series.data.prefix as string, nextNumber: Number(series.data.next_number) } : null,
      roles: ((roles.data ?? []) as Pick<Role, "id" | "name" | "system_key">[]).filter((r) => r.system_key !== "owner"),
      gstRates: (gstRates.data ?? []) as GstRate[],
      units: (units.data ?? []) as Unit[],
      invites: (invites.data ?? []) as Array<{ id: string; email: string }>,
      products: (products.data ?? []) as Array<{ id: string; name: string }>,
    };
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="flex h-14 items-center justify-between border-b bg-background px-4 sm:px-6">
        <Logo href={null} />
        <form action={signOutAction}>
          <Button variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <OnboardingWizard data={data} />
      </main>
      <PoweredBy className="pb-6 text-center" />
    </div>
  );
}
