import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Serves the service worker at /serwist/sw.js (built from app/sw.ts with esbuild,
 * because Turbopack has no plugin for it). The route is prerendered at build time
 * and sends `Service-Worker-Allowed: /`, so the worker can control the whole app.
 *
 * Precache: every hashed JS/CSS chunk and self-hosted font of this build, plus the
 * PWA icons. Chunk names are content hashes, so "the POS and its assets" cannot be
 * picked out by path: precaching the build is what guarantees the POS starts offline.
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  // esbuild-wasm (a devDependency) on every platform: no native binary to install or approve.
  useNativeEsbuild: false,
  globPatterns: [".next/static/**/*.{js,css,woff,woff2}", "public/icons/*.png"],
  // A classic script, so the worker also runs where module service workers are not supported.
  esbuildOptions: { format: "iife" },
});
