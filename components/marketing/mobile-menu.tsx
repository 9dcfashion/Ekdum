"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { NAV_LINKS } from "./site";

/** The only client island on the marketing pages: the phone navigation. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
        className="flex size-10 items-center justify-center rounded-lg border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>
      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Mobile"
          className="absolute inset-x-0 top-full border-b bg-background px-4 pt-2 pb-4 shadow-lg"
        >
          <ul className="divide-y">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={close} className="block py-3 text-base font-medium">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/login" onClick={close} className="block py-3 text-base font-medium">
                Sign in
              </Link>
            </li>
          </ul>
          <Link
            href="/signup"
            onClick={close}
            className="mt-3 flex h-12 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white"
          >
            Start free
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
