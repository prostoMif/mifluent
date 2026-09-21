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
import { hasFailedTooOften, type PolledItem, pollRssSource } from "@mifluent/sources";
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
