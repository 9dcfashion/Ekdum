/** Shared copy and link lists for the public marketing pages. */
export const SITE_NAME = "EkDum";
export const SITE_TITLE = "EkDum: GST billing, POS and inventory for Indian shops";
export const SITE_DESCRIPTION =
  "EkDum is a shop OS for Indian retailers: GST billing and POS, inventory, purchases, staff roles, digital receipts, courier dispatch log and an owner dashboard, in one panel. Powered by NineAgents.";

export const NAV_LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
] as const;

export const LEGAL_LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/refund-policy", label: "Refund policy" },
] as const;

/** Paths listed in the sitemap. */
export const PUBLIC_PATHS = ["/", "/about", "/privacy", "/terms", "/refund-policy", "/login", "/signup"] as const;
