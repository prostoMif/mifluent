/**
 * Reading watch profiles.
 *
 * Every query here goes through `scopedAlive`, which puts the tenant predicate
 * in before anything else can be added. Nothing in this file takes a tenant
 * identifier from anywhere except its own argument, and callers get that from
 * the session.
 */

import { type Queryable, schema, scopedAlive } from "@mifluent/db";
import { asc, eq } from "drizzle-orm";
import type {
  WatchProfileDetail,
  WatchProfileSummary,
  WatchProfileTarget,
  WatchProfileTopic,
} from "./types.js";

export async function listWatchProfiles(
  db: Queryable,
  tenantId: string,
): Promise<WatchProfileSummary[]> {
  return db
    .select({
      id: schema.watchProfiles.id,
      name: schema.watchProfiles.name,
      businessDescription: schema.watchProfiles.businessDescription,
      websiteUrl: schema.watchProfiles.websiteUrl,
      relevanceThreshold: schema.watchProfiles.relevanceThreshold,
      currentVersion: schema.watchProfileVersions.version,
      updatedAt: schema.watchProfiles.updatedAt,
    })
    .from(schema.watchProfiles)
    .leftJoin(
      schema.watchProfileVersions,
      eq(schema.watchProfiles.currentVersionId, schema.watchProfileVersions.id),
    )
    .where(scopedAlive(schema.watchProfiles, tenantId))
    .orderBy(asc(schema.watchProfiles.createdAt));
}

export async function findWatchProfile(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<WatchProfileDetail | undefined> {
  const [profile] = await db
    .select({
      id: schema.watchProfiles.id,
      name: schema.watchProfiles.name,
      businessDescription: schema.watchProfiles.businessDescription,
      websiteUrl: schema.watchProfiles.websiteUrl,
      relevanceThreshold: schema.watchProfiles.relevanceThreshold,
      currentVersion: schema.watchProfileVersions.version,
      updatedAt: schema.watchProfiles.updatedAt,
    })
    .from(schema.watchProfiles)
    .leftJoin(
      schema.watchProfileVersions,
      eq(schema.watchProfiles.currentVersionId, schema.watchProfileVersions.id),
    )
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);

  if (profile === undefined) {
    return undefined;
  }

  const [topics, targets, stopwords] = await Promise.all([
    listTopics(db, tenantId, profileId),
    listTargets(db, tenantId, profileId),
    listStopwords(db, tenantId, profileId),
  ]);

  return { ...profile, topics, targets, stopwords };
}

export async function listTopics(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<WatchProfileTopic[]> {
  return db
    .select({
      id: schema.topics.id,
      label: schema.topics.label,
      description: schema.topics.description,
    })
    .from(schema.topics)
    .where(scopedAlive(schema.topics, tenantId, eq(schema.topics.profileId, profileId)))
    .orderBy(asc(schema.topics.label));
}

export async function listTargets(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<WatchProfileTarget[]> {
  return db
    .select({
      id: schema.watchTargets.id,
      kind: schema.watchTargets.kind,
      name: schema.watchTargets.name,
      websiteUrl: schema.watchTargets.websiteUrl,
      aliases: schema.watchTargets.aliases,
      reason: schema.watchTargets.reason,
    })
    .from(schema.watchTargets)
    .where(scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.profileId, profileId)))
    .orderBy(asc(schema.watchTargets.name));
}

export async function listStopwords(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<string[]> {
  const rows = await db
    .select({ term: schema.stopwords.term })
    .from(schema.stopwords)
    .where(scopedAlive(schema.stopwords, tenantId, eq(schema.stopwords.profileId, profileId)))
    .orderBy(asc(schema.stopwords.term));

  return rows.map((row) => row.term);
}
