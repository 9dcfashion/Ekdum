import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EkDum",
    short_name: "EkDum",
    description: "GST billing, POS, inventory, purchases, staff and dispatch for Indian shops, in one panel.",
    id: "/",
    start_url: "/app/pos",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "en-IN",
    theme_color: "#4338CA",
    background_color: "#ffffff",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
