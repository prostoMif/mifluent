/**
 * The public radar's data for the /changes pages, cached for an hour: the
 * pages are public and crawled, and the radar changes a few times a day.
 *
 * Every read is pinned to RADAR_TENANT_ID from configuration — never to
 * anything a visitor sends.
 */

import { getConfig } from "@mifluent/core";
import {
  findPublicCompanyPage,
  listPublicChanges,
  listPublicCompanies,
  type PublicChange,
  type PublicCompany,
  type PublicCompanyPage,
} from "@mifluent/domain";
import { unstable_cache } from "next/cache";
import { getDatabase } from "./db";

const HOUR = 3_600;

export function radarTenantId(): string | undefined {
  return getConfig().RADAR_TENANT_ID;
}

export const loadRadarCompanies = unstable_cache(
  async (tenantId: string): Promise<PublicCompany[]> =>
    listPublicCompanies(getDatabase(), tenantId),
  ["radar-companies"],
  { revalidate: HOUR },
);

export const loadRadarChanges = unstable_cache(
  async (tenantId: string, language: "en" | "ru" | "all"): Promise<PublicChange[]> =>
    listPublicChanges(getDatabase(), tenantId, {
      limit: 60,
      ...(language === "all" ? {} : { language }),
    }),
  ["radar-changes"],
  { revalidate: HOUR },
);

export const loadRadarCompany = unstable_cache(
  async (tenantId: string, slug: string): Promise<PublicCompanyPage | undefined> =>
    findPublicCompanyPage(getDatabase(), tenantId, slug),
  ["radar-company"],
  { revalidate: HOUR },
);
