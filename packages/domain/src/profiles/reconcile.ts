/**
 * Bringing the stored children of a profile in line with what was submitted.
 *
 * The obvious implementation — delete every topic and insert the new list —
 * is wrong in a way that only shows up later. Each topic gets an embedding
 * computed from its text, and rows are referenced by identifier from events
 * and digests. Replacing them wholesale would recompute every embedding on
 * every save and orphan the history of anything that pointed at the old row.
 *
 * So each list is matched on its natural key — a topic's label, a target's
 * name, a stopword's term, all of which already carry a unique index per
 * profile. Unchanged rows are left exactly as they are.
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TopicInput, WatchTargetInput } from "./schemas.js";

export interface ChildScope {
  readonly tenantId: string;
  readonly profileId: string;
}

/**
 * Two topics with the same label are one topic typed twice. The unique index
 * would refuse the insert anyway; failing the whole save over it would be a
 * worse answer than quietly keeping the first.
 */
function deduplicate<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const identity = key(item).toLowerCase();
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push(item);
  }

  return result;
}

export async function syncTopics(
  db: Queryable,
  scope: ChildScope,
  topics: readonly TopicInput[],
): Promise<void> {
  const desired = deduplicate(topics, (topic) => topic.label);

  const existing = await db
    .select({ id: schema.topics.id, label: schema.topics.label })
    .from(schema.topics)
    .where(
      and(
        eq(schema.topics.tenantId, scope.tenantId),
        eq(schema.topics.profileId, scope.profileId),
        isNull(schema.topics.deletedAt),
      ),
    );

  const existingByLabel = new Map(existing.map((row) => [row.label, row.id]));
  const desiredLabels = new Set(desired.map((topic) => topic.label));

  const removedIds = existing.filter((row) => !desiredLabels.has(row.label)).map((row) => row.id);
  if (removedIds.length > 0) {
    await db
      .update(schema.topics)
      .set({ deletedAt: new Date() })
      .where(inArray(schema.topics.id, removedIds));
  }

  for (const topic of desired) {
    const existingId = existingByLabel.get(topic.label);

    if (existingId === undefined) {
      await db.insert(schema.topics).values({
        id: uuidv7(),
        tenantId: scope.tenantId,
        profileId: scope.profileId,
        label: topic.label,
        description: topic.description,
      });
      continue;
    }

    await db
      .update(schema.topics)
      .set({ description: topic.description, updatedAt: new Date() })
      .where(eq(schema.topics.id, existingId));
  }
}

export async function syncTargets(
  db: Queryable,
  scope: ChildScope,
  targets: readonly WatchTargetInput[],
): Promise<void> {
  const desired = deduplicate(targets, (target) => target.name);

  const existing = await db
    .select({ id: schema.watchTargets.id, name: schema.watchTargets.name })
    .from(schema.watchTargets)
    .where(
      and(
        eq(schema.watchTargets.tenantId, scope.tenantId),
        eq(schema.watchTargets.profileId, scope.profileId),
        isNull(schema.watchTargets.deletedAt),
      ),
    );

  const existingByName = new Map(existing.map((row) => [row.name, row.id]));
  const desiredNames = new Set(desired.map((target) => target.name));

  const removedIds = existing.filter((row) => !desiredNames.has(row.name)).map((row) => row.id);
  if (removedIds.length > 0) {
    await db
      .update(schema.watchTargets)
      .set({ deletedAt: new Date() })
      .where(inArray(schema.watchTargets.id, removedIds));
  }

  for (const target of desired) {
    const existingId = existingByName.get(target.name);

    if (existingId === undefined) {
      await db.insert(schema.watchTargets).values({
        id: uuidv7(),
        tenantId: scope.tenantId,
        profileId: scope.profileId,
        kind: target.kind,
        name: target.name,
        websiteUrl: target.websiteUrl,
        aliases: [...target.aliases],
        reason: target.reason,
      });
      continue;
    }

    await db
      .update(schema.watchTargets)
      .set({
        kind: target.kind,
        websiteUrl: target.websiteUrl,
        aliases: [...target.aliases],
        reason: target.reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.watchTargets.id, existingId));
  }
}

export async function syncStopwords(
  db: Queryable,
  scope: ChildScope,
  terms: readonly string[],
): Promise<void> {
  const desired = deduplicate(terms, (term) => term);

  const existing = await db
    .select({ id: schema.stopwords.id, term: schema.stopwords.term })
    .from(schema.stopwords)
    .where(
      and(
        eq(schema.stopwords.tenantId, scope.tenantId),
        eq(schema.stopwords.profileId, scope.profileId),
        isNull(schema.stopwords.deletedAt),
      ),
    );

  const desiredTerms = new Set(desired);
  const existingTerms = new Set(existing.map((row) => row.term));

  const removedIds = existing.filter((row) => !desiredTerms.has(row.term)).map((row) => row.id);
  if (removedIds.length > 0) {
    await db
      .update(schema.stopwords)
      .set({ deletedAt: new Date() })
      .where(inArray(schema.stopwords.id, removedIds));
  }

  // A stopword has no fields beyond its own text, so there is nothing to update
  // on the ones that stayed.
  const added = desired.filter((term) => !existingTerms.has(term));

  if (added.length > 0) {
    await db.insert(schema.stopwords).values(
      added.map((term) => ({
        id: uuidv7(),
        tenantId: scope.tenantId,
        profileId: scope.profileId,
        term,
      })),
    );
  }
}
