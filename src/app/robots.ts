import type { MetadataRoute } from "next";
import { SITE_URL, PRIVATE_PREFIXES } from "@/lib/seo/site";

/**
 * robots (Launch v6, Prompt 23). Authenticated app surfaces, admin, auth
 * callbacks and every API path are disallowed from indexing; public marketing
 * and legal pages are crawlable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_PREFIXES],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
