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
 *
 * Takes the database handle as an argument so the dry run (TASK-013) can poll
 * inside a transaction it rolls back.
 */

import { toAppError } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import {
  findLatestPageVersion,
  type PollableItem,
  type PollableSource,
  type RawItemKind,
  recordPageBaseline,
  recordPageChange,
  recordPolledItems,
  recordPollFailure,
  recordPollSuccess,
  updateSourceConfig,
} from "@mifluent/domain";
import {
  type AtsPolledItem,
  fingerprintItem,
  hasFailedTooOften,
  type KnownJob,
  pollAtsBoard,
  pollPageDiff,
  pollRssSource,
  type PolledItem as RssPolledItem,
} from "@mifluent/sources";
import { z } from "zod";
import { logger, USER_AGENT } from "./runtime.js";

export interface PollOutcome {
  readonly label: string;
  readonly result: "stored" | "unchanged" | "baseline" | "failed" | "skipped";
  readonly stored: number;
  readonly duplicates: number;
  readonly message?: string | undefined;
}

export interface PollSourceOptions {
  readonly db: Queryable;
  readonly source: PollableSource;
  readonly now: Date;
}

/** What the job-board connector remembers between polls, in `sources.config`. */
const jobMemorySchema = z.object({
  lastJobs: z.array(z.object({ id: z.string(), title: z.string() })).catch([]),
});

export async function pollSource(options: PollSourceOptions): Promise<PollOutcome> {
  const { source } = options;

  if (source.locator === null) {
    return { label: source.label, result: "skipped", stored: 0, duplicates: 0 };
  }

  try {
    return await collect(options, source.locator);
  } catch (thrown) {
    return await recordFailure(options, thrown);
  }
}

async function collect(options: PollSourceOptions, locator: string): Promise<PollOutcome> {
  switch (options.source.kind) {
    case "diff":
      return collectPageDiff(options, locator);
    case "json":
      return collectJobBoard(options, locator);
    default:
      return collectFeed(options, locator);
  }
}

async function collectFeed(options: PollSourceOptions, locator: string): Promise<PollOutcome> {
  const { db, source, now } = options;

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
      db,
      tenantId: source.tenantId,
      sourceId: source.id,
      ...validators,
      now,
    });
    return { label: source.label, result: "unchanged", stored: 0, duplicates: 0 };
  }

  const written = await recordPolledItems({
    db,
    tenantId: source.tenantId,
    sourceId: source.id,
    items: result.items.map(fromFeedItem),
    kind: feedItemKind(locator),
    now,
  });

  await recordPollSuccess({
    db,
    tenantId: source.tenantId,
    sourceId: source.id,
    ...validators,
    now,
  });
  return logStored(source, written.stored, written.duplicates);
}

async function collectPageDiff(options: PollSourceOptions, locator: string): Promise<PollOutcome> {
  const { db, source, now } = options;
  const previous = await findLatestPageVersion(db, source.tenantId, source.id);

  const diff = await pollPageDiff({
    url: locator,
    userAgent: USER_AGENT,
    previousHash: previous?.contentHash,
    previousText: previous?.extractedText,
  });

  if (diff.isUnchanged) {
    await recordPollSuccess({ db, tenantId: source.tenantId, sourceId: source.id, now });
    return { label: source.label, result: "unchanged", stored: 0, duplicates: 0 };
  }

  const version = {
    tenantId: source.tenantId,
    sourceId: source.id,
    contentHash: diff.contentHash,
    extractedText: diff.extractedText,
    fetchedAt: now,
  };

  if (previous === undefined) {
    await recordPageBaseline(db, version);
    await recordPollSuccess({ db, tenantId: source.tenantId, sourceId: source.id, now });
    return { label: source.label, result: "baseline", stored: 0, duplicates: 0 };
  }

  const isStored = await recordPageChange(db, {
    ...version,
    pageUrl: locator,
    label: source.label,
    added: diff.added,
    removed: diff.removed,
    // Identity by source and time, not by URL: every change to one page has
    // the same URL, and a fingerprint built from it would keep only the first
    // change ever seen. The time also makes a page that flips A→B, back, and
    // A→B again count as two changes.
    fingerprint: fingerprintItem({
      externalId: `${source.id}:${now.toISOString()}`,
      url: null,
      title: source.label,
      content: `${diff.added}\n${diff.removed}`,
      feedUrl: locator,
    }),
  });

  await recordPollSuccess({ db, tenantId: source.tenantId, sourceId: source.id, now });
  return logStored(source, isStored ? 1 : 0, isStored ? 0 : 1);
}

async function collectJobBoard(options: PollSourceOptions, locator: string): Promise<PollOutcome> {
  const { db, source, now } = options;
  const memory = jobMemorySchema.parse(source.config);

  const result = await pollAtsBoard({
    boardUrl: locator,
    userAgent: USER_AGENT,
    // Empty on the first poll, so nothing is reported as closed before the
    // board has been seen once.
    previousJobs: memory.lastJobs,
    now,
  });

  const written = await recordPolledItems({
    db,
    tenantId: source.tenantId,
    sourceId: source.id,
    items: [...result.items, ...result.closedItems].map(fromJobItem),
    kind: "job",
    now,
  });

  await updateSourceConfig(db, source.tenantId, source.id, {
    ...source.config,
    lastJobs: result.currentJobs satisfies readonly KnownJob[],
  });
  await recordPollSuccess({ db, tenantId: source.tenantId, sourceId: source.id, now });

  return logStored(source, written.stored, written.duplicates);
}

async function recordFailure(options: PollSourceOptions, thrown: unknown): Promise<PollOutcome> {
  const { db, source, now } = options;
  const error = toAppError(thrown);
  const failures = source.consecutiveFailures + 1;
  const isBroken = hasFailedTooOften(failures);

  await recordPollFailure({
    db,
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

function logStored(source: PollableSource, stored: number, duplicates: number): PollOutcome {
  logger.info("sources.polled", { sourceId: source.id, stored, duplicates });
  return { label: source.label, result: "stored", stored, duplicates };
}

function fromFeedItem(item: RssPolledItem): PollableItem {
  return {
    fingerprint: item.fingerprint,
    externalId: item.externalId,
    url: item.url,
    title: item.title,
    author: item.author,
    // The teaser is used when the feed carries no body, and the title when
    // there is not even that: a title alone is thin, but an item with no text
    // at all could never be embedded and would stall the queue behind it.
    content: item.content ?? item.summary ?? item.title,
    publishedAt: item.publishedAt,
  };
}

function fromJobItem(item: AtsPolledItem): PollableItem {
  return {
    fingerprint: item.fingerprint,
    externalId: item.externalId,
    url: item.url,
    title: item.title,
    author: item.author,
    content: item.content === "" ? item.title : item.content,
    publishedAt: item.publishedAt,
    metadata: item.metadata,
  };
}

/** A GitHub releases feed carries releases, which the selection prompt treats differently. */
function feedItemKind(locator: string): RawItemKind {
  const url = new URL(locator);
  const isGithubReleases = url.hostname === "github.com" && url.pathname.endsWith("/releases.atom");
  return isGithubReleases ? "release" : "article";
}
