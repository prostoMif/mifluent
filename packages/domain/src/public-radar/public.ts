/**
 * What the public pages at /changes may read: the radar tenant's verified
 * events and nothing else.
 *
 * Every query here is pinned to the radar tenant id the caller passes from
 * configuration, never to anything in the request. The return types are
 * projections: headline, fact, quote, link, date, kind — no internal ids of
 * profiles, no "why it matters", nothing of any other tenant.
 *
 * // TODO: security review — unauthenticated reads
 */

import { type Queryable, schema, scopedAlive } from "@mifluent/db";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { fetchPriceChanges } from "../targets/history.js";
import { slugify } from "./files.js";

export interface PublicCompany {
  readonly slug: string;
  readonly name: string;
  readonly category: string | null;
  readonly website: string | null;
  readonly language: "en" | "ru";
}

export interface PublicChange {
  readonly slug: string;
  readonly company: string;
  readonly kind: string | null;
  readonly summary: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
  readonly occurredAt: Date;
  readonly language: "en" | "ru";
}

export interface PublicPriceChange {
  readonly kind: "price" | "plan";
  readonly was: string | null;
  readonly became: string;
  readonly sourceUrl: string | null;
  readonly occurredAt: Date;
}

/** Every company the radar follows, for the index and the sitemap. */
export async function listPublicCompanies(
  db: Queryable,
  radarTenantId: string,
): Promise<PublicCompany[]> {
  const rows = await db
    .select({
      name: schema.watchTargets.name,
      category: schema.watchTargets.reason,
      website: schema.watchTargets.websiteUrl,
      facts: schema.watchProfiles.facts,
    })
    .from(schema.watchTargets)
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.watchTargets.profileId))
    .where(scopedAlive(schema.watchTargets, radarTenantId))
    .orderBy(asc(schema.watchTargets.name));

  return rows.map((row) => ({
    slug: slugify(row.name),
    name: row.name,
    category: row.category,
    website: row.website,
    language: row.facts.language === "ru" ? "ru" : "en",
  }));
}

/** The latest verified changes across all companies, newest first. */
export async function listPublicChanges(
  db: Queryable,
  radarTenantId: string,
  options: {
    readonly language?: "en" | "ru";
    readonly limit?: number;
    readonly targetId?: string;
  } = {},
): Promise<PublicChange[]> {
  const conditions = [
    eq(schema.events.tenantId, radarTenantId),
    isNotNull(schema.events.targetId),
    // Only events with at least one verified quote: the page shows the quote.
    sql`exists (select 1 from ${schema.facts} where ${schema.facts.eventId} = ${schema.events.id})`,
  ];
  if (options.targetId !== undefined) conditions.push(eq(schema.events.targetId, options.targetId));
  if (options.language !== undefined) {
    conditions.push(sql`${schema.watchProfiles.facts} ->> 'language' = ${options.language}`);
  }

  const rows = await db
    .select({
      eventId: schema.events.id,
      company: schema.watchTargets.name,
      kind: schema.events.kind,
      summary: schema.events.summary,
      sourceUrl: schema.events.sourceUrl,
      occurredAt:
        sql<Date>`coalesce(${schema.events.occurredAt}, ${schema.events.createdAt})`.mapWith(
          (value: string | Date) => new Date(value),
        ),
      facts: schema.watchProfiles.facts,
    })
    .from(schema.events)
    .innerJoin(schema.watchTargets, eq(schema.watchTargets.id, schema.events.targetId))
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.events.profileId))
    .where(and(...conditions))
    .orderBy(desc(sql`coalesce(${schema.events.occurredAt}, ${schema.events.createdAt})`))
    .limit(options.limit ?? 50);

  const quotes = await firstQuotes(
    db,
    radarTenantId,
    rows.map((row) => row.eventId),
  );
  return rows.map((row) => ({
    slug: slugify(row.company),
    company: row.company,
    kind: row.kind,
    summary: row.summary,
    quote: quotes.get(row.eventId) ?? null,
    sourceUrl: row.sourceUrl,
    occurredAt: row.occurredAt,
    language: row.facts.language === "ru" ? "ru" : "en",
  }));
}

export interface PublicCompanyPage {
  readonly company: PublicCompany;
  readonly changes: readonly PublicChange[];
  readonly priceChanges: readonly PublicPriceChange[];
}

/** One company's page; undefined for a slug the radar does not follow. */
export async function findPublicCompanyPage(
  db: Queryable,
  radarTenantId: string,
  slug: string,
): Promise<PublicCompanyPage | undefined> {
  const targets = await db
    .select({
      id: schema.watchTargets.id,
      name: schema.watchTargets.name,
      category: schema.watchTargets.reason,
      website: schema.watchTargets.websiteUrl,
      facts: schema.watchProfiles.facts,
    })
    .from(schema.watchTargets)
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.watchTargets.profileId))
    .where(scopedAlive(schema.watchTargets, radarTenantId));
  const target = targets.find((row) => slugify(row.name) === slug);
  if (target === undefined) return undefined;

  const changes = await listPublicChanges(db, radarTenantId, { targetId: target.id, limit: 100 });
  const prices = await fetchPriceChanges(db, radarTenantId, target.id);
  return {
    company: {
      slug,
      name: target.name,
      category: target.category,
      website: target.website,
      language: target.facts.language === "ru" ? "ru" : "en",
    },
    changes,
    priceChanges: prices.map((change) => ({
      kind: change.kind,
      was: change.was,
      became: change.became,
      sourceUrl: change.sourceUrl,
      occurredAt: change.occurredAt,
    })),
  };
}

async function firstQuotes(
  db: Queryable,
  radarTenantId: string,
  eventIds: readonly string[],
): Promise<Map<string, string>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: schema.facts.eventId, quote: schema.facts.quote })
    .from(schema.facts)
    .where(
      and(eq(schema.facts.tenantId, radarTenantId), inArray(schema.facts.eventId, [...eventIds])),
    )
    .orderBy(asc(schema.facts.createdAt));
  const quotes = new Map<string, string>();
  for (const row of rows) {
    if (!quotes.has(row.eventId)) quotes.set(row.eventId, row.quote);
  }
  return quotes;
}
