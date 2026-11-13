"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NativeSelect } from "@/components/shared/field";
import { SETTINGS_NAV, activeSettingsHref } from "@/lib/settings/nav";
import { cn } from "@/lib/utils";

/** Settings sub-navigation: a select on phones, wrapping tabs from the sm breakpoint up. */
export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeSettingsHref(pathname);

  return (
    <div className="no-print mb-6">
      <div className="sm:hidden">
        <label htmlFor="settings-section" className="sr-only">
          Settings section
        </label>
        <NativeSelect id="settings-section" value={active} onChange={(e) => router.push(e.target.value)} className="h-9">
          {SETTINGS_NAV.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <nav aria-label="Settings sections" className="hidden flex-wrap gap-x-1 gap-y-0.5 border-b sm:flex">
        {SETTINGS_NAV.map((item) => {
          const isActive = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-2.5 py-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                isActive
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
