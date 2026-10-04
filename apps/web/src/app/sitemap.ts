import { getConfig } from "@mifluent/core";
import type { MetadataRoute } from "next";
import { loadRadarCompanies, radarTenantId } from "@/lib/radar";

export const dynamic = "force-dynamic";

/** The public pages: the landing, pricing and the radar. Nothing behind a sign-in. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getConfig().APP_URL.replace(/\/+$/, "");
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly" },
    { url: `${base}/pricing`, changeFrequency: "monthly" },
    { url: `${base}/terms`, changeFrequency: "yearly" },
    { url: `${base}/privacy`, changeFrequency: "yearly" },
    { url: `${base}/contacts`, changeFrequency: "yearly" },
  ];
  const tenantId = radarTenantId();
  if (tenantId === undefined) return pages;

  pages.push({ url: `${base}/changes`, changeFrequency: "daily" });
  for (const company of await loadRadarCompanies(tenantId)) {
    pages.push({ url: `${base}/changes/${company.slug}`, changeFrequency: "daily" });
  }
  return pages;
}
