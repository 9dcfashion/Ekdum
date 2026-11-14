"use client";

import { useState } from "react";
import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { Check, ChevronsUpDown, LogOut, Menu, Plus, Store } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { switchBusinessAction, switchOutletAction } from "@/app/app/actions";
import { Logo, PoweredBy } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAction } from "@/lib/use-action";
import { SidebarNav } from "./sidebar-nav";

export interface ShellData {
  userName: string;
  userEmail: string;
  roleName: string;
  businessId: string;
  businessName: string;
  memberships: Array<{ businessId: string; businessName: string; roleName: string }>;
  outlets: Array<{ id: string; name: string }>;
  outletId: string | null;
  permissions: string[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

export function BusinessSwitcher({ data }: { data: ShellData }) {
  const router = useRouter();
  const { run, pending } = useAction();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto w-full justify-between gap-2 px-2.5 py-1.5" disabled={pending}>
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm font-medium">{data.businessName}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{data.roleName}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your businesses</DropdownMenuLabel>
        {data.memberships.map((m) => (
          <DropdownMenuItem
            key={m.businessId}
            onSelect={() => {
              if (m.businessId === data.businessId) return;
              run(() => switchBusinessAction(m.businessId), {
                onSuccess: () => {
                  router.replace("/app");
                  router.refresh();
                },
              });
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{m.businessName}</span>
              <span className="block text-xs text-muted-foreground">{m.roleName}</span>
            </span>
            {m.businessId === data.businessId ? <Check className="size-4" aria-label="Current" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/onboarding?new=1")}>
          <Plus aria-hidden /> Add another business
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OutletSwitcher({ data }: { data: ShellData }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const current = data.outlets.find((o) => o.id === data.outletId);
  if (!current) return null;
  if (data.outlets.length === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Store className="size-4" aria-hidden /> {current.name}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} aria-label="Switch outlet">
          <Store aria-hidden /> <span className="max-w-32 truncate">{current.name}</span>
          <ChevronsUpDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Outlet</DropdownMenuLabel>
        {data.outlets.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() => {
              if (o.id !== data.outletId) run(() => switchOutletAction(o.id), { onSuccess: () => router.refresh() });
            }}
          >
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === data.outletId ? <Check className="size-4" aria-label="Current" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu({ data }: { data: ShellData }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          {initials(data.userName || data.userEmail)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{data.userName || "Your account"}</span>
          <span className="block truncate text-xs text-muted-foreground">{data.userEmail}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOutAction()}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Slide-in navigation for phones and small tablets. */
export function MobileNav({ data, trigger }: { data: ShellData; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
            <Menu />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle>
            <Logo href={null} />
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-4">
            <BusinessSwitcher data={data} />
          </div>
          <SidebarNav permissions={data.permissions} onNavigate={() => setOpen(false)} />
        </div>
        <PoweredBy className="border-t p-3 text-center" />
      </SheetContent>
    </Sheet>
  );
}
