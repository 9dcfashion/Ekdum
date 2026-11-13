import { Store, UserRound } from "lucide-react";
import { PosStatus } from "@/components/pos/offline-status";
import { PosBackLink } from "@/components/pos/pos-back-link";
import { PosOutletSwitcher } from "@/components/pos/pos-outlet-switcher";
import { PosServiceWorker } from "@/components/pos/service-worker";
import { ShortcutLegend } from "@/components/pos/shortcut-legend";
import { requirePage } from "@/lib/auth/context";
import { switchOutletAction } from "../actions";

export const metadata = { title: "Billing" };

/** Full-screen billing: no sidebar, a slim top bar, and the page never scrolls as a whole. */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePage("sales.create");
  const outlets = ctx.outlets.map((o) => ({ id: o.id, name: o.name }));

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-muted/30">
      <header className="no-print flex h-11 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-3">
        <PosBackLink businessId={ctx.business.id} />
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden />
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <Store className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {outlets.length > 1 && ctx.outlet ? (
            <PosOutletSwitcher outlets={outlets} activeId={ctx.outlet.id} switchOutlet={switchOutletAction} />
          ) : (
            <span className="truncate font-medium">{ctx.outlet?.name ?? "No outlet"}</span>
          )}
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <PosStatus businessId={ctx.business.id} outletId={ctx.outlet?.id ?? null} canDiscard={ctx.can("sales.cancel")} />
          <span className="hidden min-w-0 items-center gap-1.5 text-sm text-muted-foreground lg:flex">
            <UserRound className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{ctx.profile.full_name || ctx.user.email}</span>
          </span>
          <ShortcutLegend />
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
      <PosServiceWorker />
    </div>
  );
}
