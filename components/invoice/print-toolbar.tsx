"use client";

import { Printer, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

export interface PrintFormatLink {
  label: string;
  href: string;
  active: boolean;
}

/**
 * On-screen controls for the print view (hidden on paper) and the one-time
 * automatic print dialog once the slip and its images (logo, QR) have loaded.
 */
export function PrintToolbar({
  formats,
  backHref,
  autoPrint,
  logoToggle,
}: {
  formats: PrintFormatLink[];
  backHref: string;
  autoPrint: boolean;
  /** Null when the business has no logo. */
  logoToggle: { on: boolean; href: string } | null;
}) {
  const printed = useRef(false);

  useEffect(() => {
    if (!autoPrint || printed.current) return;
    let cancelled = false;
    const print = () => {
      if (cancelled || printed.current) return;
      printed.current = true;
      window.print();
    };
    const pending = Array.from(document.images).filter((image) => !image.complete);
    let left = pending.length;
    const onSettled = () => {
      left -= 1;
      if (left <= 0) window.setTimeout(print, 150);
    };
    for (const image of pending) {
      image.addEventListener("load", onSettled, { once: true });
      image.addEventListener("error", onSettled, { once: true });
    }
    // Print when everything has loaded, or after 3 seconds if an image never arrives.
    const timer = window.setTimeout(print, pending.length === 0 ? 300 : 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const image of pending) {
        image.removeEventListener("load", onSettled);
        image.removeEventListener("error", onSettled);
      }
    };
  }, [autoPrint]);

  function close() {
    // Works when the print view was opened in its own tab or window; otherwise go back to the bill.
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.location.assign(backHref);
    }, 150);
  }

  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-center gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur">
      <Button type="button" onClick={() => window.print()}>
        <Printer aria-hidden />
        Print
      </Button>
      <nav aria-label="Paper size" className="flex items-center rounded-lg border p-0.5">
        {formats.map((format) => (
          <a
            key={format.label}
            href={format.href}
            aria-current={format.active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
              format.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {format.label}
          </a>
        ))}
      </nav>
      {logoToggle ? (
        <Button asChild variant="outline">
          <a href={logoToggle.href}>{logoToggle.on ? "Hide logo" : "Show logo"}</a>
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={close}>
        <X aria-hidden />
        Close
      </Button>
    </div>
  );
}
