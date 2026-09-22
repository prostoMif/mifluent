/**
 * Polling one source, from fetch to stored rows.
 *
 * The rule that shapes this file: **a source that cannot be read is not a
 * failed job.** An unreachable feed, a page that has become HTML, a certificate
 * that expired — none of these are going to be fixed by trying again in ten
 * seconds, and all of them are ordinary. They are recorded as the source's
 * state and the job finishes successfully.
 *
 * What that buys is a queue whose failures mean something. A job that actually
 * fails here is a bug or a database that has gone away, and those are worth
 * retrying and worth waking somebody for. If every dead feed also counted as a
 * failed job, the queue's error count would be noise and nobody would look at
 * it — which is the same disease as logging client mistakes at error level.
 *
 * It also keeps the two backoffs from fighting. The source has its own, which
 * doubles the interval as failures pile up; letting the queue retry as well
 * would multiply one by the other and produce delays nobody chose.
 */

import { toAppError } from "@mifluent/core";
import {
  type PollableSource,
  recordPolledItems,
  recordPollFailure,
  recordPollSuccess,
} from "@mifluent/domain";
import { hasFailedTooOften, type PolledItem, pollPageDiff, pollRssSource } from "@mifluent/sources";
import { getDatabase, logger, USER_AGENT } from "./runtime.js";

export interface PollOutcome {
  readonly label: string;
  readonly result: "stored" | "unchanged" | "failed" | "skipped";
  readonly stored: number;
  readonly duplicates: number;
  readonly message?: string | undefined;
}

export async function pollSource(source: PollableSource, now: Date): Promise<PollOutcome> {
  if (source.locator === null) {
    return { label: source.label, result: "skipped", stored: 0, duplicates: 0 };
  }

  try {
    return await collect(source, source.locator, now);
  } catch (thrown) {
    return await recordFailure(source, thrown, now);
  }
}

async function collect(source: PollableSource, locator: string, now: Date): Promise<PollOutcome> {
  const database = getDatabase();

  // Handle diff kind separately
  if (source.kind === "diff") {
    return await collectDiff(source, locator, now);
  }

  const result = await pollRssSource({
    feedUrl: locator,
    userAgent: USER_AGENT,
    ...(source.etag === null ? {} : { etag: source.etag }),
    ...(source.lastModifiedHeader === null ? {} : { lastModifiedAt: source.lastModifiedHeader }),
    now,
  });

  const validators = {
    ...(result.etag === undefined ? {} : { etag: result.etag }),
    ...(result.lastModifiedAt === undefined ? {} : { lastModifiedHeader: result.lastModifiedAt }),
  };

  if (result.isUnchanged) {
    await recordPollSuccess({
      db: database,
      tenantId: source.tenantId,
      sourceId: source.id,
      ...validators,
      now,
    });

    return { label: source.label, result: "unchanged", stored: 0, duplicates: 0 };
  }

  const written = await recordPolledItems({
    db: database,
    tenantId: source.tenantId,
    sourceId: source.id,
    items: result.items.map(toStorableItem),
    now,
  });

  await recordPollSuccess({
    db: database,
    tenantId: source.tenantId,
    sourceId: source.id,
    ...validators,
    now,
  });

  logger.info("sources.polled", {
    sourceId: source.id,
    stored: written.stored,
    duplicates: written.duplicates,
  });

  return {
    label: source.label,
    result: "stored",
    stored: written.stored,
    duplicates: written.duplicates,
  };
}

async function recordFailure(
  source: PollableSource,
  thrown: unknown,
  now: Date,
): Promise<PollOutcome> {
  const error = toAppError(thrown);
  const failures = source.consecutiveFailures + 1;
  const isBroken = hasFailedTooOften(failures);

  await recordPollFailure({
    db: getDatabase(),
    tenantId: source.tenantId,
    sourceId: source.id,
    code: error.code,
    message: error.message,
    isBroken,
    now,
  });

  logger.warn("sources.poll_failed", {
    sourceId: source.id,
    code: error.code,
    consecutiveFailures: failures,
    isBroken,
    details: error.details,
  });

  return {
    label: source.label,
    result: "failed",
    stored: 0,
    duplicates: 0,
    message: error.message,
  };
}

interface StorableItem {
  readonly fingerprint: string;
  readonly externalId: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly content: string | null;
  readonly publishedAt: Date | null;
}

function toStorableItem(item: PolledItem): StorableItem {
  return {
    fingerprint: item.fingerprint,
    externalId: item.externalId,
    url: item.url,
    title: item.title,
    author: item.author,
    // The teaser is used when the feed carries no body, because a title alone
    // gives the classifier almost nothing to work with.
    content: item.content ?? item.summary,
    publishedAt: item.publishedAt,
  };
}

async function collectDiff(
  source: PollableSource,
  locator: string,
  now: Date,
): Promise<PollOutcome> {
  const database = getDatabase();

  const { schema } = await import("@mifluent/db");
  const { uuidv7 } = await import("@mifluent/core");
  const { eq, desc } = await import("drizzle-orm");

  // Get the latest page version for this source
  const [latestVersion] = await database
    .select({
      contentHash: schema.pageVersions.contentHash,
      extractedText: schema.pageVersions.extractedText,
      addedText: schema.pageVersions.addedText,
      removedText: schema.pageVersions.removedText,
    })
    .from(schema.pageVersions)
    .where(eq(schema.pageVersions.sourceId, source.id))
    .orderBy(desc(schema.pageVersions.fetchedAt))
    .limit(1);

  const previousHash = latestVersion?.contentHash ?? null;
  const previousText = latestVersion?.extractedText ?? null;

  const diffResult = await pollPageDiff({
    url: locator,
    userAgent: USER_AGENT,
    previousHash: previousHash ?? undefined,
    previousText: previousText ?? undefined,
  });

  if (diffResult.isUnchanged) {
    await recordPollSuccess({
      db: database,
      tenantId: source.tenantId,
      sourceId: source.id,
      now,
    });

    return { label: source.label, result: "unchanged", stored: 0, duplicates: 0 };
  }

  // Baseline (first poll): store page_versions but don't create raw_item
  if (diffResult.added === "" && diffResult.removed === "") {
    await database.insert(schema.pageVersions).values({
      id: uuidv7(),
      tenantId: source.tenantId,
      sourceId: source.id,
      contentHash: diffResult.contentHash,
      extractedText: diffResult.extractedText,
      addedText: null,
      removedText: null,
      fetchedAt: now,
    });

    await recordPollSuccess({
      db: database,
      tenantId: source.tenantId,
      sourceId: source.id,
      now,
    });

    // Cleanup old versions (keep max 20)
    await cleanupOldVersions(database, source.tenantId, source.id);

    return { label: source.label, result: "stored", stored: 0, duplicates: 0 };
  }

  // Changed: store new page_version + raw_item
  const pageVersionId = uuidv7();

  await database.transaction(async (tx) => {
    // Store page version
    await tx.insert(schema.pageVersions).values({
      id: pageVersionId,
      tenantId: source.tenantId,
      sourceId: source.id,
      contentHash: diffResult.contentHash,
      extractedText: diffResult.extractedText,
      addedText: diffResult.added,
      removedText: diffResult.removed,
      fetchedAt: now,
    });

    // Create raw_item
    const rawItemId = uuidv7();
    const content = `ADDED:\n${diffResult.added}\n\nREMOVED:\n${diffResult.removed}`;
    const fingerprint = (await import("@mifluent/sources")).fingerprintItem({
      externalId: null,
      url: locator,
      title: source.label,
      content,
      feedUrl: locator,
    });

    await tx.insert(schema.rawItems).values({
      id: rawItemId,
      tenantId: source.tenantId,
      sourceId: source.id,
      externalId: null,
      url: locator,
      title: source.label,
      author: null,
      content,
      contentHash: fingerprint,
      publishedAt: now,
      fetchedAt: now,
      kind: "diff",
      pageVersionId,
    });
  });

  await recordPollSuccess({
    db: database,
    tenantId: source.tenantId,
    sourceId: source.id,
    now,
  });

  // Cleanup old versions (keep max 20)
  await cleanupOldVersions(database, source.tenantId, source.id);

  logger.info("sources.polled", {
    sourceId: source.id,
    stored: 1,
    duplicates: 0,
  });

  return {
    label: source.label,
    result: "stored",
    stored: 1,
    duplicates: 0,
  };
}

async function cleanupOldVersions(
  database: import("@mifluent/db").Database,
  _tenantId: string,
  sourceId: string,
): Promise<void> {
  const { schema } = await import("@mifluent/db");
  const { eq, desc } = await import("drizzle-orm");

  const versions = await database
    .select({ id: schema.pageVersions.id })
    .from(schema.pageVersions)
    .where(eq(schema.pageVersions.sourceId, sourceId))
    .orderBy(desc(schema.pageVersions.fetchedAt))
    .limit(21);

  if (versions.length > 20) {
    const toDelete = versions.slice(20);
    await database.delete(schema.pageVersions).where(
      (await import("drizzle-orm")).inArray(
        schema.pageVersions.id,
        toDelete.map((item: { id: string }) => item.id),
      ),
    );
  }
}
