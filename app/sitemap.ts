import type { MetadataRoute } from "next";
import { PUBLIC_PATHS } from "@/components/marketing/site";
import { absoluteUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/signup" ? 0.8 : 0.4,
  }));
}
