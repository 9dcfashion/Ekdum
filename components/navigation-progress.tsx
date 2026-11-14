"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const START_EVENT = "ekdum:navigation-start";
/** Do not flash the bar for navigations that finish almost instantly. */
const SHOW_DELAY_MS = 80;
/** Give up quietly if a navigation never completes (e.g. it was cancelled). */
const SAFETY_MS = 20_000;

/**
 * Start the top progress bar from code, for navigations made with
 * router.push / router.replace after an action (links start it on their own).
 */
export function startNavigationProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(START_EVENT));
}

/**
 * A thin bar across the top of the screen that appears the moment a link is
 * tapped and finishes when the new page has arrived. Without it, a tap on a
 * slow connection (or a first visit in development) looks like nothing happened.
 * Driven by direct style updates on a ref, so it never re-renders the app.
 */
export function NavigationProgress() {
  const barRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const timers = useRef<Timers>({ active: false, value: 0 });

  // Finish whenever the URL actually changes.
  useEffect(() => {
    finish(barRef.current, timers.current);
  }, [pathname, search]);

  useEffect(() => {
    const t = timers.current;
    const start = () => begin(barRef.current, t);

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener(START_EVENT, start);
    window.addEventListener("popstate", start);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(START_EVENT, start);
      window.removeEventListener("popstate", start);
      clearAll(t);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]">
      <div
        ref={barRef}
        className="h-full origin-left bg-primary opacity-0 shadow-[0_0_8px_var(--primary)] motion-safe:transition-[transform,opacity] motion-safe:duration-200"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}

type Timers = { show?: number; trickle?: number; hide?: number; safety?: number; active: boolean; value: number };

function clearAll(t: Timers) {
  window.clearTimeout(t.show);
  window.clearInterval(t.trickle);
  window.clearTimeout(t.hide);
  window.clearTimeout(t.safety);
}

function paint(bar: HTMLDivElement | null, value: number, visible: boolean) {
  if (!bar) return;
  bar.style.transform = `scaleX(${value})`;
  bar.style.opacity = visible ? "1" : "0";
}

function begin(bar: HTMLDivElement | null, t: Timers) {
  clearAll(t);
  t.active = true;
  t.value = 0.08;
  t.show = window.setTimeout(() => {
    paint(bar, t.value, true);
    // Creep towards 90% while waiting; the last stretch happens when the page arrives.
    t.trickle = window.setInterval(() => {
      t.value = Math.min(0.9, t.value + (0.9 - t.value) * 0.08);
      paint(bar, t.value, true);
    }, 200);
  }, SHOW_DELAY_MS);
  t.safety = window.setTimeout(() => finish(bar, t), SAFETY_MS);
}

function finish(bar: HTMLDivElement | null, t: Timers) {
  if (!t.active) return;
  t.active = false;
  clearAll(t);
  if (!bar || bar.style.opacity !== "1") {
    paint(bar, 0, false);
    return;
  }
  paint(bar, 1, true);
  t.hide = window.setTimeout(() => {
    paint(bar, 1, false);
    t.hide = window.setTimeout(() => paint(bar, 0, false), 250);
  }, 180);
}
