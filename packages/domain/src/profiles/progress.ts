/**
 * How far a new profile's first run has got, as counts a person can watch.
 *
 * Read from the tables the run writes to, not from the job: the counts are the
 * truth, and they keep meaning something after the job itself is gone.
 */

import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import { eq, sql } from "drizzle-orm";

export interface ProfileProgress {
  readonly sources: number;
  readonly sourcesRead: number;
  readonly items: number;
  readonly selected: number;
  readonly hasDigest: boolean;
}

export async function readProfileProgress(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<ProfileProgress> {
  const [sources] = await db
    .select({
      total: sql<number>`count(*)::int`,
      read: sql<number>`count(${schema.sources.lastPolledAt})::int`,
    })
    .from(schema.sources)
    .where(scopedAlive(schema.sources, tenantId, eq(schema.sources.profileId, profileId)));

  const [items] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.rawItems)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.rawItems.sourceId))
    .where(scoped(schema.rawItems, tenantId, eq(schema.sources.profileId, profileId)));

  const [events] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.events)
    .where(scoped(schema.events, tenantId, eq(schema.events.profileId, profileId)));

  const [digests] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.digests)
    .where(scoped(schema.digests, tenantId, eq(schema.digests.profileId, profileId)));

  return {
    sources: sources?.total ?? 0,
    sourcesRead: sources?.read ?? 0,
    items: items?.total ?? 0,
    selected: events?.total ?? 0,
    hasDigest: (digests?.total ?? 0) > 0,
  };
}

export interface TargetWithoutSources {
  readonly id: string;
  readonly name: string;
  readonly websiteUrl: string;
}

/**
 * Targets a person added by hand during onboarding: a name and a site, and no
 * idea yet where to watch them. The first run finds that out.
 */
export async function listTargetsWithoutSources(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<TargetWithoutSources[]> {
  const rows = await db
    .select({
      id: schema.watchTargets.id,
      name: schema.watchTargets.name,
      websiteUrl: schema.watchTargets.websiteUrl,
    })
    .from(schema.watchTargets)
    .where(
      scopedAlive(
        schema.watchTargets,
        tenantId,
        eq(schema.watchTargets.profileId, profileId),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.sources} WHERE ${schema.sources.targetId} = ${schema.watchTargets.id} AND ${schema.sources.deletedAt} IS NULL)`,
      ),
    );

  return rows.flatMap((row) =>
    row.websiteUrl === null ? [] : [{ ...row, websiteUrl: row.websiteUrl }],
  );
}
