"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const SW_URL = "/serwist/sw.js";
const UPDATE_CHECK_MS = 60 * 60_000;

/** Production builds only (set NEXT_PUBLIC_SW=off to switch it off, or =on to try it in development). */
const enabled = process.env.NEXT_PUBLIC_SW === "on" || (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_SW !== "off");

/**
 * Registers the service worker from the POS, so the billing screen can start
 * without a network. A new version never takes over on its own: the cashier
 * sees "new version, reload" and chooses the moment (the POS already asks before
 * a reload throws away a bill in progress).
 */
export function PosServiceWorker() {
  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    let stopped = false;
    let accepted = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const offerUpdate = (worker: ServiceWorker) => {
      toast("A new version of EkDum is ready", {
        id: "ekdum-sw-update",
        description: "Finish the bill you are on, then reload. Saved bills are not affected.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            accepted = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    };

    // The new worker took over because the cashier pressed Reload (in this tab).
    const onControllerChange = () => {
      if (accepted) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(SW_URL, { scope: "/" })
      .then((registration) => {
        if (stopped) return;
        if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            // "installed" with a controller already in place means an update, not the first install.
            if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
          });
        });
        timer = setInterval(() => {
          if (navigator.onLine) void registration.update().catch(() => undefined);
        }, UPDATE_CHECK_MS);
        // Save the offline copy of the POS page for this user and outlet.
        void navigator.serviceWorker.ready.then((ready) => {
          if (navigator.onLine) ready.active?.postMessage({ type: "EKDUM_WARM_POS" });
        });
      })
      .catch(() => undefined); // no service worker (private window, http): the POS still works online

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
