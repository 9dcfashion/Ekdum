export interface SettingsNavItem {
  href: string;
  label: string;
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  { href: "/app/settings", label: "Business profile" },
  { href: "/app/settings/branding", label: "Branding" },
  { href: "/app/settings/payments", label: "Bank and UPI" },
  { href: "/app/settings/invoice", label: "Invoice settings" },
  { href: "/app/settings/outlets", label: "Outlets" },
  { href: "/app/settings/series", label: "Invoice series" },
  { href: "/app/settings/devices", label: "POS devices" },
  { href: "/app/settings/couriers", label: "Courier partners" },
  { href: "/app/settings/notifications", label: "Notifications" },
  { href: "/app/settings/data", label: "Data export" },
  { href: "/app/settings/audit", label: "Audit log" },
];

/** The nav item a pathname belongs to (longest matching href wins). */
export function activeSettingsHref(pathname: string): string {
  const match = SETTINGS_NAV.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.href ?? "/app/settings";
}

/** Names only. Tracking links differ by account and change over time, so the owner adds and checks them. */
export const COMMON_COURIERS = [
  "Delhivery",
  "DTDC",
  "Blue Dart",
  "India Post",
  "Ekart",
  "Xpressbees",
  "Shadowfax",
  "Professional Couriers",
] as const;
