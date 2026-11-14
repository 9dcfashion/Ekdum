import { Logo, PoweredBy } from "@/components/brand";
import { BottomNav } from "@/components/app/bottom-nav";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { BusinessSwitcher, MobileNav, OutletSwitcher, UserMenu, type ShellData } from "@/components/app/topbar";
import { requireContext } from "@/lib/auth/context";

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  // Fire and forget: "last active" on the staff page. Never blocks rendering.
  void ctx.supabase.rpc("touch_member_activity", { p_business_id: ctx.business.id }).then(() => undefined, () => undefined);

  const data: ShellData = {
    userName: ctx.profile.full_name,
    userEmail: ctx.user.email,
    roleName: ctx.role.name,
    businessId: ctx.business.id,
    businessName: ctx.business.trade_name || ctx.business.legal_name,
    memberships: ctx.memberships.map((m) => ({ businessId: m.businessId, businessName: m.businessName, roleName: m.roleName })),
    outlets: ctx.outlets.map((o) => ({ id: o.id, name: o.name })),
    outletId: ctx.outlet?.id ?? null,
    permissions: [...ctx.permissions],
  };

  return (
    <div className="flex min-h-dvh">
      <aside className="no-print sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center px-4">
          <Logo href="/app" />
        </div>
        <div className="px-3 pb-3">
          <BusinessSwitcher data={data} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <SidebarNav permissions={data.permissions} />
        </div>
        <PoweredBy className="border-t px-4 py-3" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
          <MobileNav data={data} />
          <Logo href="/app" className="lg:hidden" />
          <div className="ml-auto flex items-center gap-3">
            <OutletSwitcher data={data} />
            <UserMenu data={data} />
          </div>
        </header>
        {/* Bottom padding on phones keeps content clear of the bottom bar. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 pt-5 pb-24 sm:px-5 lg:pb-5">{children}</main>
        <BottomNav data={data} />
      </div>
    </div>
  );
}
