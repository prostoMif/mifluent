import { getConfig } from "@mifluent/core";
import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

/** Crawl the public pages; keep out of everything that belongs to a signed-in account. */
export default function robots(): MetadataRoute.Robots {
  const base = getConfig().APP_URL.replace(/\/+$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/pricing", "/changes"],
      disallow: [
        "/api/",
        "/a/",
        "/r/",
        "/unsubscribe/",
        "/today",
        "/settings",
        "/watching",
        "/targets",
        "/reports",
        "/tg",
        "/showcase",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
