/**
 * The one place a profile reads rows it does not own.
 *
 * Pack material is fetched once, into the service tenant, and judged
 * separately for every profile that follows the pack. Every other query in the
 * codebase is scoped to the caller's tenant; this module is the documented
 * exception, and it stays narrow on purpose:
 *
 * - it reads only the service tenant (`PACKS_TENANT_ID`), never another
 *   customer's tenant;
 * - it reads only sources linked to the packs the caller passes in, which the
 *   caller computed from the profile's own facts;
 * - it returns material (public pages and feeds), never anything a person
 *   wrote.
 *
 * Anything that needs pack material goes through here. A second path would be
 * a second thing to audit.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { and, eq, gte, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import type { CataloguedPack } from "./match.js";
import { PACKS_TENANT_ID } from "./tenant.js";

export interface PackCandidate {
  readonly id: string;
  readonly title: string | null;
  readonly url: string | null;
  readonly content: string;
  readonly kind: string;
  readonly publishedAt: Date | null;
  readonly fetchedAt: Date;
  readonly packKey: string;
  readonly packKind: CataloguedPack["definition"]["kind"];
}

export interface PackCandidateQuery {
  /** The profile the material will be judged for, and its tenant. */
  readonly tenantId: string;
  readonly profileId: string;
  /** Packs the profile follows, from `matchPacks`. */
  readonly packs: readonly CataloguedPack[];
  readonly since: Date;
  readonly limit: number;
}

/** Every pack in the catalogue. Small: read whole on each selection run. */
export async function loadPackCatalogue(db: Queryable): Promise<CataloguedPack[]> {
  return db
    .select({ key: schema.sourcePacks.key, definition: schema.sourcePacks.definition })
    .from(schema.sourcePacks);
}

/**
 * Pack material this profile has not judged yet: no event of this profile
 * contains it, and this profile has not rejected it.
 */
export async function packCandidates(
  db: Queryable,
  query: PackCandidateQuery,
): Promise<PackCandidate[]> {
  if (query.packs.length === 0) return [];

  const kindByKey = new Map(query.packs.map((pack) => [pack.key, pack.definition.kind]));
  const rows = await db
    .select({
      id: schema.rawItems.id,
      title: schema.rawItems.title,
      url: schema.rawItems.url,
      content: schema.rawItems.content,
      kind: schema.rawItems.kind,
      publishedAt: schema.rawItems.publishedAt,
      fetchedAt: schema.rawItems.fetchedAt,
      packKey: schema.packSources.packKey,
    })
    .from(schema.rawItems)
    .innerJoin(schema.packSources, eq(schema.packSources.sourceId, schema.rawItems.sourceId))
    .where(
      scoped(
        schema.rawItems,
        PACKS_TENANT_ID,
        inArray(schema.packSources.packKey, [...kindByKey.keys()]),
        gte(schema.rawItems.fetchedAt, query.since),
        or(isNull(schema.rawItems.publishedAt), gte(schema.rawItems.publishedAt, query.since)),
        sql`EXISTS (SELECT 1 FROM ${schema.chunks} WHERE ${schema.chunks.rawItemId} = ${schema.rawItems.id})`,
        notExists(
          db
            .select({ id: schema.eventItems.id })
            .from(schema.eventItems)
            .innerJoin(schema.events, eq(schema.events.id, schema.eventItems.eventId))
            .where(
              scoped(
                schema.events,
                query.tenantId,
                eq(schema.eventItems.rawItemId, schema.rawItems.id),
                eq(schema.events.profileId, query.profileId),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: schema.rejections.id })
            .from(schema.rejections)
            .where(
              scoped(
                schema.rejections,
                query.tenantId,
                and(
                  eq(schema.rejections.rawItemId, schema.rawItems.id),
                  eq(schema.rejections.profileId, query.profileId),
                ),
              ),
            ),
        ),
      ),
    )
    .orderBy(schema.rawItems.fetchedAt)
    .limit(query.limit);

  // One item can sit in two packs the profile follows; it is judged once.
  const seen = new Set<string>();
  const candidates: PackCandidate[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    candidates.push({ ...row, packKind: kindByKey.get(row.packKey) ?? "media" });
  }
  return candidates;
}

/**
 * How many sources of the packs a profile follows were read since `since`:
 * the "about your country and niche" part of "checked N sources". Counts the
 * service tenant's sources only — never another customer's.
 */
export async function countPackSourcesChecked(
  db: Queryable,
  packKeys: readonly string[],
  since: Date,
): Promise<number> {
  if (packKeys.length === 0) return 0;
  const [row] = await db
    .select({ total: sql<number>`count(distinct ${schema.sources.id})::int` })
    .from(schema.packSources)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.packSources.sourceId))
    .where(
      and(
        eq(schema.sources.tenantId, PACKS_TENANT_ID),
        inArray(schema.packSources.packKey, [...packKeys]),
        gte(schema.sources.lastPolledAt, since),
      ),
    );
  return row?.total ?? 0;
}
