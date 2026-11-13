/// <reference lib="webworker" />
/**
 * EkDum service worker (Serwist). Its only job is to let the POS start and keep
 * billing with no network. What it does per kind of request:
 *
 *  /_next/static/**, fonts, icons   precached at install (cache-first; names are content hashes)
 *  navigation to /app/pos           network first (4s). If the network is down or slow, the saved
 *                                   POS "shell" page: the same screen with no products in it. The
 *                                   till then loads its catalog from IndexedDB.
 *  everything else                  not touched: /api/**, Server Action POSTs, auth pages, /i/**,
 *                                   every other page and all RSC data always go to the network.
 *
 * The shell is the only authenticated HTML ever stored. It holds the outlet name,
 * the seller details printed on a slip and the cashier's permissions, never the
 * catalog, customers or sales. It is deleted when the POS redirects to sign-in or
 * someone opens a sign-in page.
 *
 * Updates: a new worker waits. The POS shows "new version, reload" and the worker
 * takes over only when the cashier presses it (never in the middle of a bill).
 */
import { ExpirationPlugin, Serwist, StaleWhileRevalidate, type PrecacheEntry, type RouteHandlerCallback, type SerwistGlobalConfig } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const POS_PATH = "/app/pos";
// Must match POS_SHELL_HEADER in lib/offline/protocol.ts (the worker is bundled on its own, so it does not import app code).
const SHELL_HEADER = "x-ekdum-shell";
const SHELL_PREFIX = "ekdum-pos-shell-";
const STATIC_CACHE = "ekdum-next-static";
const NAVIGATION_TIMEOUT_MS = 4000;
const WARM_TIMEOUT_MS = 15_000;
const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/accept-invite"];

const manifest = self.__SW_MANIFEST ?? [];

/** A short fingerprint of this build's assets, so each worker version keeps its own shell page. */
function fingerprint(entries: (PrecacheEntry | string)[]): string {
  let hash = 0x811c9dc5;
  for (const entry of entries) {
    const text = typeof entry === "string" ? entry : `${entry.url}:${entry.revision ?? ""}`;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
const SHELL_CACHE = `${SHELL_PREFIX}${fingerprint(manifest)}`;

const serwist = new Serwist({
  precacheEntries: manifest,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // Hosts that add a deployment id to asset URLs must still hit the precache.
    ignoreURLParametersMatching: [/^dpl$/, /^utm_/, /^fbclid$/],
  },
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
});

/**
 * Fetch the POS shell and keep it, but only if it belongs to THIS build: every
 * script and stylesheet it names must be in this worker's precache. Right after
 * a deploy the old worker would otherwise save a page it cannot start offline.
 */
async function warmShell(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WARM_TIMEOUT_MS);
  try {
    const response = await fetch(POS_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "text/html", [SHELL_HEADER]: "1" },
      signal: controller.signal,
    });
    if (response.redirected || new URL(response.url).pathname !== POS_PATH) {
      // Sent to the sign-in page: nobody is signed in, so no saved POS page may stay behind.
      await clearShells();
      return false;
    }
    if (!response.ok) return false;
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) return false;
    const html = await response.clone().text();
    const assets = html.match(/\/_next\/static\/[^"'\\\s)]+\.(?:js|css)/g) ?? [];
    if (assets.length === 0 || assets.some((url) => !serwist.getPrecacheKeyForUrl(url))) return false;
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(POS_PATH, response);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function clearShells(keep?: string): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names.filter((n) => n.startsWith(SHELL_PREFIX) && n !== keep).map((n) => caches.delete(n)));
}

const cachedShell = async () => (await caches.open(SHELL_CACHE)).match(POS_PATH);

/** POS page: the live page when the network answers in time, the saved shell when it does not. */
const posNavigation: RouteHandlerCallback = async ({ request }) => {
  const network = fetch(request);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([network, timeout]);
    if (response && response.status < 500) {
      // A redirect from the POS can only be to the sign-in page: the session is over, forget the saved page.
      if (response.type === "opaqueredirect" || response.redirected) void clearShells().catch(() => undefined);
      return response;
    }
  } catch {
    // offline: fall through to the shell
  } finally {
    clearTimeout(timer);
  }
  const shell = await cachedShell();
  if (shell) return shell;
  // No shell saved on this device yet: all we can do is wait for the network.
  return network.catch(() => Response.error());
};

/** Hashed build assets that are not in the precache (for example after a deploy): any cache, then the network. */
const staticAsset: RouteHandlerCallback = async ({ request }) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    void cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
};

/** Sign-in pages mean the session ended or is changing hands: forget the saved POS page, then go to the network. */
const authPage: RouteHandlerCallback = async ({ request }) => {
  await clearShells().catch(() => undefined);
  return fetch(request);
};

serwist.registerCapture(({ request, url, sameOrigin }) => sameOrigin && request.mode === "navigate" && url.pathname === POS_PATH, posNavigation);
serwist.registerCapture(({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"), staticAsset);
serwist.registerCapture(
  ({ request, url, sameOrigin }) =>
    sameOrigin && AUTH_PATHS.includes(url.pathname) && request.headers.get("Next-Router-Prefetch") !== "1" && request.headers.get("Purpose") !== "prefetch",
  authPage,
);
serwist.registerCapture(
  ({ url, sameOrigin }) => sameOrigin && (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest"),
  new StaleWhileRevalidate({ cacheName: "ekdum-app-icons", plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 30 * 24 * 60 * 60 })] }),
);

serwist.addEventListeners();

// The new build's shell is saved while the network is certainly there (install needs it anyway).
self.addEventListener("install", (event) => {
  event.waitUntil(warmShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await clearShells(SHELL_CACHE);
      if (!(await cachedShell())) await warmShell();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = (event.data as { type?: string } | null)?.type;
  if (type === "EKDUM_WARM_POS") event.waitUntil(warmShell());
  if (type === "EKDUM_CLEAR_POS") event.waitUntil(clearShells());
});
