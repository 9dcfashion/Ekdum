"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, LayoutDashboard, Menu, ReceiptText, ScanBarcode, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileNav, type ShellData } from "./topbar";

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  perms: string[];
  /** Highlighted as the main action. */
  primary?: boolean;
  /** Paths that count as "this tab" besides href. */
  match?: string[];
}

// The jobs staff do most, in the order they reach for them. At most four plus "More".
const TABS: Tab[] = [
  { href: "/app/dashboard", label: "Home", icon: LayoutDashboard, perms: ["dashboard.view"] },
  { href: "/app/pos", label: "New bill", icon: ScanBarcode, perms: ["sales.create"], primary: true },
  { href: "/app/purchases/new", label: "Purchase", icon: ShoppingBag, perms: ["purchases.create"], match: ["/app/purchases"] },
  { href: "/app/sales", label: "Sales", icon: ReceiptText, perms: ["sales.view_all", "sales.view_own"] },
  { href: "/app/shipments", label: "Shipments", icon: Truck, perms: ["shipments.view"] },
  { href: "/app/inventory", label: "Stock", icon: Boxes, perms: ["inventory.view"] },
];

/** Phone-only bottom bar: the main jobs one tap away, everything else under "More". */
export function BottomNav({ data }: { data: ShellData }) {
  const pathname = usePathname();
  const allowed = new Set(data.permissions);
  const tabs = TABS.filter((t) => t.perms.some((p) => allowed.has(p))).slice(0, 4);
  if (tabs.length === 0) return null;

  const isActive = (t: Tab) => [t.href, ...(t.match ?? [])].some((h) => pathname === h || pathname.startsWith(`${h}/`));

  return (
    <nav
      aria-label="Quick actions"
      className="no-print fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {tabs.map((t) => {
          const active = isActive(t);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:bg-muted",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full",
                    t.primary ? "size-9 bg-primary text-primary-foreground shadow-sm" : "size-7",
                  )}
                >
                  <t.icon className="size-5" aria-hidden />
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <MobileNav
            data={data}
            trigger={
              <button
                type="button"
                className="flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground outline-none focus-visible:bg-muted"
                aria-label="More options"
              >
                <span className="flex size-7 items-center justify-center">
                  <Menu className="size-5" aria-hidden />
                </span>
                More
              </button>
            }
          />
        </li>
      </ul>
    </nav>
  );
}
