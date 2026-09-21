/**
 * Creating, saving and removing a watch profile.
 *
 * A save is one transaction covering the profile row, its topics, its targets,
 * its stopwords and — if any of that changed what gets selected — a new version
 * row. Splitting it into separate requests per list would leave a profile
 * halfway between two shapes whenever a browser tab closed at the wrong moment,
 * and the version recorded next to it would describe neither.
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Database, type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { findWatchProfile, listStopwords, listTargets, listTopics } from "./read.js";
import type { ChildScope } from "./reconcile.js";
import { syncStopwords, syncTargets, syncTopics } from "./reconcile.js";
import type { WatchProfileInput } from "./schemas.js";
import { areSnapshotsEqual, type SelectionSnapshot } from "./snapshot.js";
import type { WatchProfileDetail } from "./types.js";

function makeFacts(
  facts: {
    monetization?: "free" | "trial" | "subscription" | "one_time" | "unknown" | null;
    platforms?: string[];
    countries?: string[];
    customerType?: string | null;
    whatMatters?: string | null;
    language?: "en" | "ru" | null;
  } | null,
): SelectionSnapshot["facts"] {
  if (!facts) return null;
  const monetization = (facts.monetization ?? "unknown") as
    | "free"
    | "trial"
    | "subscription"
    | "one_time"
    | "unknown";
  const result: SelectionSnapshot["facts"] = {
    monetization,
    platforms: facts.platforms ?? [],
    countries: facts.countries ?? [],
    customerType: facts.customerType ?? "",
    whatMatters: facts.whatMatters ?? "",
    language: (facts.language ?? "en") as "en" | "ru",
  };
  return result;
}

export interface SaveProfileOptions {
  readonly db: Database;
  readonly tenantId: string;
  readonly input: WatchProfileInput;
}

export interface UpdateProfileOptions extends SaveProfileOptions {
  readonly profileId: string;
}

export async function createWatchProfile(options: SaveProfileOptions): Promise<WatchProfileDetail> {
  const { db, tenantId, input } = options;
  const profileId = uuidv7();

  await db.transaction(async (transaction) => {
    await transaction.insert(schema.watchProfiles).values({
      id: profileId,
      tenantId,
      name: input.name,
      businessDescription: input.businessDescription,
      websiteUrl: input.websiteUrl,
      relevanceThreshold: input.relevanceThreshold,
    });

    await writeChildren(transaction, { tenantId, profileId }, input);
    await recordVersionIfChanged(transaction, tenantId, profileId, input.changeReason);
  });

  return requireProfile(await findWatchProfile(db, tenantId, profileId));
}

export async function saveWatchProfile(options: UpdateProfileOptions): Promise<WatchProfileDetail> {
  const { db, tenantId, profileId, input } = options;

  await db.transaction(async (transaction) => {
    const updated = await transaction
      .update(schema.watchProfiles)
      .set({
        name: input.name,
        businessDescription: input.businessDescription,
        websiteUrl: input.websiteUrl,
        relevanceThreshold: input.relevanceThreshold,
        updatedAt: new Date(),
      })
      // The tenant predicate is the ownership check. A profile belonging to
      // somebody else matches nothing and the update reports zero rows, which
      // is indistinguishable from "no such profile" — as it should be.
      .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
      .returning({ id: schema.watchProfiles.id });

    if (updated.length === 0) {
      throw new AppError("not_found", "Not found.");
    }

    await writeChildren(transaction, { tenantId, profileId }, input);
    await recordVersionIfChanged(transaction, tenantId, profileId, input.changeReason);
  });

  return requireProfile(await findWatchProfile(db, tenantId, profileId));
}

/**
 * Soft deletion, because a person removing a profile by accident should be able
 * to get it back, and because events and digests still point at it.
 */
export async function deleteWatchProfile(
  db: Database,
  tenantId: string,
  profileId: string,
): Promise<void> {
  const removed = await db
    .update(schema.watchProfiles)
    .set({ deletedAt: new Date() })
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .returning({ id: schema.watchProfiles.id });

  if (removed.length === 0) {
    throw new AppError("not_found", "Not found.");
  }
}

async function writeChildren(
  db: Queryable,
  scope: ChildScope,
  input: WatchProfileInput,
): Promise<void> {
  await syncTopics(db, scope, input.topics);
  await syncTargets(db, scope, input.targets);
  await syncStopwords(db, scope, input.stopwords);
}

/**
 * Record a new version, but only if selection actually changed.
 *
 * The snapshot is read back from the database rather than built from the
 * submitted payload. That way it reflects what was really stored — including
 * the deduplication and trimming that happened on the way in — so a version
 * always describes rows that exist.
 */
async function recordVersionIfChanged(
  db: Queryable,
  tenantId: string,
  profileId: string,
  changeReason: string | null,
): Promise<void> {
  const snapshot = await buildSelectionSnapshot(db, tenantId, profileId);
  const previous = await findCurrentSnapshot(db, tenantId, profileId);

  if (previous !== undefined && areSnapshotsEqual(previous.snapshot, snapshot)) {
    return;
  }

  const versionId = uuidv7();
  const version = (previous?.version ?? 0) + 1;

  await db.insert(schema.watchProfileVersions).values({
    id: versionId,
    tenantId,
    profileId,
    version,
    snapshot,
    changeReason,
  });

  await db
    .update(schema.watchProfiles)
    .set({ currentVersionId: versionId })
    .where(eq(schema.watchProfiles.id, profileId));
}

async function buildSelectionSnapshot(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<SelectionSnapshot> {
  const [profile] = await db
    .select({
      businessDescription: schema.watchProfiles.businessDescription,
      relevanceThreshold: schema.watchProfiles.relevanceThreshold,
      facts: schema.watchProfiles.facts,
    })
    .from(schema.watchProfiles)
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);

  if (profile === undefined) {
    throw new AppError("not_found", "Not found.");
  }

  const [topics, targets, stopwords] = await Promise.all([
    listTopics(db, tenantId, profileId),
    listTargets(db, tenantId, profileId),
    listStopwords(db, tenantId, profileId),
  ]);

  const facts = profile.facts as {
    monetization?: "free" | "trial" | "subscription" | "one_time" | "unknown" | null;
    platforms?: string[];
    countries?: string[];
    customerType?: string | null;
    whatMatters?: string | null;
    language?: "en" | "ru" | null;
  } | null;

  const factsResult = makeFacts(facts);

  const result: SelectionSnapshot = {
    businessDescription: profile.businessDescription,
    relevanceThreshold: profile.relevanceThreshold,
    topics: topics.map((topic) => ({ label: topic.label, description: topic.description })),
    targets: targets.map((target) => ({
      kind: target.kind,
      name: target.name,
      aliases: target.aliases,
    })),
    stopwords,
    facts: factsResult,
  };

  return result;
}

interface StoredVersion {
  readonly version: number;
  readonly snapshot: SelectionSnapshot;
}

/**
 * Lenient on purpose. This reads history, not user input: a snapshot missing a
 * field is an old row, and the only sensible response is to treat that field as
 * empty rather than to fail the save happening now.
 */
const storedSnapshotSchema = z.object({
  businessDescription: z.string().nullable().catch(null),
  relevanceThreshold: z.number().catch(0),
  topics: z
    .array(z.object({ label: z.string(), description: z.string().nullable().catch(null) }))
    .catch([]),
  targets: z
    .array(
      z.object({
        kind: z.string(),
        name: z.string(),
        aliases: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  stopwords: z.array(z.string()).catch([]),
  facts: z
    .object({
      monetization: z
        .enum(["free", "trial", "subscription", "one_time", "unknown"])
        .optional()
        .catch(undefined),
      platforms: z.array(z.string()).catch([]),
      countries: z.array(z.string()).catch([]),
      customerType: z.string().nullable().catch(null),
      whatMatters: z.string().nullable().catch(null),
      language: z.enum(["en", "ru"]).optional().catch(undefined),
    })
    .nullable()
    .catch(null),
});

const EMPTY_SNAPSHOT: SelectionSnapshot = {
  businessDescription: null,
  relevanceThreshold: 0,
  topics: [],
  targets: [],
  stopwords: [],
  facts: null,
};

/**
 * The newest version of this profile, if it has one.
 *
 * Reads the highest version number rather than following `current_version_id`:
 * the two agree, but the ordering is what the next version number is derived
 * from, and taking both facts from one query removes the chance of them
 * disagreeing.
 */
async function findCurrentSnapshot(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<StoredVersion | undefined> {
  const [row] = await db
    .select({
      version: schema.watchProfileVersions.version,
      snapshot: schema.watchProfileVersions.snapshot,
    })
    .from(schema.watchProfileVersions)
    // `scoped`, not `scopedAlive`: versions are history and are never deleted,
    // so the table has no `deleted_at` to filter on.
    .where(
      scoped(
        schema.watchProfileVersions,
        tenantId,
        eq(schema.watchProfileVersions.profileId, profileId),
      ),
    )
    .orderBy(desc(schema.watchProfileVersions.version))
    .limit(1);

  if (row === undefined) {
    return undefined;
  }

  return { version: row.version, snapshot: readSnapshot(row.snapshot) };
}

/**
 * A stored snapshot comes back from `jsonb` as `unknown`.
 *
 * It was written by this file, so the shape is ours — but a version written by
 * an older build is still in the table and must not crash a save. Parsing it
 * with the same schema the rest of the codebase uses means an unreadable old
 * row degrades into "different from the current one", which produces one extra
 * version and nothing worse.
 */
function readSnapshot(stored: unknown): SelectionSnapshot {
  const result = storedSnapshotSchema.safeParse(stored);

  if (result.success) {
    return result.data as SelectionSnapshot;
  }

  return EMPTY_SNAPSHOT;
}

function requireProfile(profile: WatchProfileDetail | undefined): WatchProfileDetail {
  if (profile === undefined) {
    throw new AppError("internal_error", "Something went wrong on our side.", {
      reason: "profile disappeared immediately after being written",
    });
  }

  return profile;
}
