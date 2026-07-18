import type { MetadataRoute } from "next";
import { canonical, PUBLIC_ROUTES } from "@/lib/seo/site";

/**
 * sitemap (Launch v6, Prompt 23). Public, indexable pages only — never
 * authenticated or API routes. Login/signup are included as entry points but
 * carry a low priority.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PUBLIC_ROUTES.map((route) => ({
    url: canonical(route),
    lastModified: now,
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : route === "/pricing" ? 0.8 : 0.5,
  }));
}
