"use client";

import { useSyncExternalStore } from "react";

/**
 * Small browser hooks for the phone "quick bill" flow. Everything here is
 * read through useSyncExternalStore, so the server render and hydration see a
 * fixed value and the real one arrives right after, with no mismatch.
 */

/** Tailwind's `lg` breakpoint: at this width and up the POS is the keyboard-first desktop screen. */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/** For event handlers: is the desktop layout on screen right now? */
export function isDesktopNow(): boolean {
  return typeof window === "undefined" || window.matchMedia(DESKTOP_QUERY).matches;
}

function subscribeDesktop(notify: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

/** True at `lg` and up. True on the server, so dialogs decided by it are never rendered there anyway. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, isDesktopNow, () => true);
}

// ── On-screen keyboard ──────────────────────────────────────────────────────

function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv || vv.scale > 1.01) return 0;
  const layoutHeight = document.documentElement.clientHeight;
  return Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop));
}

function subscribeViewport(notify: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  vv.addEventListener("resize", notify);
  vv.addEventListener("scroll", notify);
  return () => {
    vv.removeEventListener("resize", notify);
    vv.removeEventListener("scroll", notify);
  };
}

/**
 * How much of the bottom of the screen the phone keyboard covers, in px.
 * Android Chrome and iOS Safari lay the keyboard over the page instead of
 * shrinking it, so a bottom sheet lifts itself by this much to keep its
 * fields and buttons visible. 0 when there is no keyboard (and on the server).
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeViewport, keyboardInset, () => 0);
}

// ── Device storage ──────────────────────────────────────────────────────────

const STORAGE_EVENT = "ekdum:pos-storage";
/** Used when the browser blocks localStorage (private mode, policy): values last until the page closes. */
const memory = new Map<string, string>();

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function subscribeStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(STORAGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(STORAGE_EVENT, notify);
  };
}

/** A localStorage value that re-renders when it changes. `undefined` on the server and during hydration. */
export function useStoredValue(key: string): string | null | undefined {
  return useSyncExternalStore(
    subscribeStorage,
    () => readStored(key),
    () => undefined,
  );
}

// ── Camera barcode scanning ─────────────────────────────────────────────────

const subscribeNever = () => () => undefined;

/** Chrome on Android (and some desktops) can read barcodes from the camera with no extra library. */
export function cameraScanSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

/** False on the server and where the browser has no BarcodeDetector, so the Scan button simply does not appear. */
export function useCameraScanSupported(): boolean {
  return useSyncExternalStore(subscribeNever, cameraScanSupported, () => false);
}
