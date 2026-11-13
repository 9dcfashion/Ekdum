import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/api", "/i", "/onboarding", "/auth", "/setup"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
