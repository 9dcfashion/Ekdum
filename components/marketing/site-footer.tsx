import Link from "next/link";
import { Logo, PoweredBy, TAGLINE } from "@/components/brand";
import { LEGAL_LINKS, NAV_LINKS } from "./site";

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 text-xl font-semibold tracking-tight">{TAGLINE}</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            GST billing, POS, inventory, purchases, staff and dispatch for Indian shops, in one panel.
          </p>
        </div>
        <nav aria-label="Product">
          <h2 className="text-sm font-semibold">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-foreground hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/login" className="hover:text-foreground hover:underline">
                Sign in
              </Link>
            </li>
            <li>
              <Link href="/signup" className="hover:text-foreground hover:underline">
                Start free
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="Company and legal">
          <h2 className="text-sm font-semibold">Company</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-foreground hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 sm:px-6">
          <PoweredBy />
          <p className="text-xs text-muted-foreground">Made in India for Indian shops.</p>
        </div>
      </div>
    </footer>
  );
}
