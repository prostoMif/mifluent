/**
 * Bring the database in line with the pack files: the service tenant and its
 * profile exist, every pack's sources exist and are active, the catalogue
 * describes every pack, and sources no file mentions any more are paused.
 *
 * Idempotent: running it twice changes nothing the second time. Sources are
 * paused rather than deleted when a pack drops them, so the material already
 * fetched — and the events other profiles built from it — keep their links.
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import type { SourcePackDefinition } from "@mifluent/db/schema";
import { eq, isNull, notInArray } from "drizzle-orm";
import type { PackFile, PackSourceEntry } from "./schema.js";
import { PACKS_PROFILE_ID, PACKS_TENANT_ID } from "./tenant.js";

export interface PackSyncResult {
  readonly packs: number;
  readonly sourcesCreated: number;
  readonly sourcesReactivated: number;
  readonly sourcesPaused: number;
  /** Entries marked `broken` in their file, left out until someone fixes them. */
  readonly sourcesSkippedBroken: number;
}

export async function syncPacks(
  db: Queryable,
  packs: readonly PackFile[],
  now: Date = new Date(),
): Promise<PackSyncResult> {
  return db.transaction(async (transaction) => {
    await ensureServiceTenant(transaction);
    // Links are rebuilt from the files every run: inside one transaction that
    // is simpler than diffing them, and a source moved between packs cannot
    // keep a stale link to the pack it left.
    await transaction.delete(schema.packSources);

    const tally: SourceTally = { created: 0, reactivated: 0, skippedBroken: 0, keptIds: [] };
    for (const pack of packs) {
      await upsertCatalogueEntry(transaction, pack, now);
      await syncPackSources(transaction, pack, tally);
    }

    const sourcesPaused = await pauseUnlistedSources(transaction, tally.keptIds);
    await removeUnlistedPacks(
      transaction,
      packs.map((pack) => pack.key),
    );

    return {
      packs: packs.length,
      sourcesCreated: tally.created,
      sourcesReactivated: tally.reactivated,
      sourcesPaused,
      sourcesSkippedBroken: tally.skippedBroken,
    };
  });
}

interface SourceTally {
  created: number;
  reactivated: number;
  skippedBroken: number;
  keptIds: string[];
}

async function syncPackSources(db: Queryable, pack: PackFile, tally: SourceTally): Promise<void> {
  for (const entry of pack.sources) {
    if (entry.broken !== undefined) {
      tally.skippedBroken += 1;
      continue;
    }
    const outcome = await ensurePackSource(db, pack, entry);
    tally.keptIds.push(outcome.sourceId);
    if (outcome.created) tally.created += 1;
    if (outcome.reactivated) tally.reactivated += 1;
  }
}

/** The YAML's snake_case rules, in the shape the catalogue stores. */
export function toDefinition(pack: PackFile): SourcePackDefinition {
  return {
    title: pack.title,
    market: pack.market,
    countries: pack.countries,
    regions: pack.regions,
    appliesTo: pack.applies_to,
    kind: pack.kind,
    niches: pack.niches,
    appliesWhen: {
      platformsAny: pack.applies_when.platforms_any,
      nichesAny: pack.applies_when.niches_any,
    },
    maxCardsPerDigest: pack.max_cards_per_digest,
  };
}

/**
 * The service tenant owns every pack source. Its profile has no version, so
 * the digest scheduler and the selection step both pass it by: it exists only
 * because a source must belong to a profile.
 */
async function ensureServiceTenant(db: Queryable): Promise<void> {
  await db
    .insert(schema.tenants)
    .values({ id: PACKS_TENANT_ID, name: "Mifluent source packs", timezone: "UTC" })
    .onConflictDoNothing();

  await db
    .insert(schema.watchProfiles)
    .values({
      id: PACKS_PROFILE_ID,
      tenantId: PACKS_TENANT_ID,
      name: "Source packs",
      businessDescription: null,
    })
    .onConflictDoNothing();
}

async function upsertCatalogueEntry(db: Queryable, pack: PackFile, now: Date): Promise<void> {
  const definition = toDefinition(pack);
  await db
    .insert(schema.sourcePacks)
    .values({ key: pack.key, definition, syncedAt: now })
    .onConflictDoUpdate({
      target: schema.sourcePacks.key,
      set: { definition, syncedAt: now, updatedAt: now },
    });
}

const SOURCE_KIND: Readonly<Record<PackSourceEntry["type"], "rss" | "diff">> = {
  feed: "rss",
  query: "rss",
  diff: "diff",
};

async function ensurePackSource(
  db: Queryable,
  pack: PackFile,
  entry: PackSourceEntry,
): Promise<{ sourceId: string; created: boolean; reactivated: boolean }> {
  const kind = SOURCE_KIND[entry.type];
  const [existing] = await db
    .select({ id: schema.sources.id, status: schema.sources.status })
    .from(schema.sources)
    .where(
      scoped(
        schema.sources,
        PACKS_TENANT_ID,
        eq(schema.sources.profileId, PACKS_PROFILE_ID),
        eq(schema.sources.kind, kind),
        eq(schema.sources.locator, entry.url),
        isNull(schema.sources.deletedAt),
      ),
    )
    .limit(1);

  const label = `${pack.title.en} — ${entry.label}`.slice(0, 120);
  let sourceId: string;
  let created = false;
  let reactivated = false;

  if (existing === undefined) {
    sourceId = uuidv7();
    created = true;
    await db.insert(schema.sources).values({
      id: sourceId,
      tenantId: PACKS_TENANT_ID,
      profileId: PACKS_PROFILE_ID,
      kind,
      label,
      locator: entry.url,
      pollIntervalMinutes: entry.interval_minutes,
    });
  } else {
    sourceId = existing.id;
    reactivated = existing.status === "paused";
    await db
      .update(schema.sources)
      .set({
        label,
        pollIntervalMinutes: entry.interval_minutes,
        ...(reactivated ? { status: "active" as const } : {}),
      })
      .where(scoped(schema.sources, PACKS_TENANT_ID, eq(schema.sources.id, sourceId)));
  }

  await db
    .insert(schema.packSources)
    .values({ id: uuidv7(), packKey: pack.key, sourceId })
    .onConflictDoNothing();

  return { sourceId, created, reactivated };
}

async function pauseUnlistedSources(
  db: Queryable,
  keptSourceIds: readonly string[],
): Promise<number> {
  const paused = await db
    .update(schema.sources)
    .set({ status: "paused" })
    .where(
      scoped(
        schema.sources,
        PACKS_TENANT_ID,
        eq(schema.sources.status, "active"),
        isNull(schema.sources.deletedAt),
        keptSourceIds.length === 0 ? undefined : notInArray(schema.sources.id, [...keptSourceIds]),
      ),
    )
    .returning({ id: schema.sources.id });

  return paused.length;
}

/** Packs whose file was deleted leave the catalogue; their sources are already paused. */
async function removeUnlistedPacks(db: Queryable, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) {
    await db.delete(schema.sourcePacks);
    return;
  }
  await db.delete(schema.sourcePacks).where(notInArray(schema.sourcePacks.key, [...keys]));
}
