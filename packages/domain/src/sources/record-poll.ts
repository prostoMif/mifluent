/**
 * Writing down what a poll found, and what it did to the source.
 *
 * Deliberately knows nothing about RSS. It takes items that have already been
 * fetched, parsed and given an identity, so the same function will serve the
 * Reddit connector and the page-diff connector without being touched. The
 * caller wires a connector to this; neither knows about the other.
 *
 * Two things happen here and they are equally important. The obvious one is
 * storing new material. The other is recording how the poll went — because a
 * source that quietly stopped working looks exactly like a quiet week, and
 * telling those apart is the whole reason the failure columns exist.
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scopedById } from "@mifluent/db";
import { eq } from "drizzle-orm";

/**
 * One thing a connector found.
 *
 * `content` is text, never markup: the connector converts before it gets here,
 * so nothing downstream has to remember to.
 */
export interface PollableItem {
  readonly fingerprint: string;
  readonly externalId: string | null;
  readonly url: string | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly content: string | null;
  readonly publishedAt: Date | null;
}

export interface RecordItemsOptions {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly sourceId: string;
  readonly items: readonly PollableItem[];
  readonly now?: Date | undefined;
}

export interface RecordItemsResult {
  /** Rows actually written. */
  readonly stored: number;
  /** Seen before, under this tenant, and skipped. */
  readonly duplicates: number;
}

export async function recordPolledItems(options: RecordItemsOptions): Promise<RecordItemsResult> {
  const usable = options.items.filter((item) => hasSomethingToSay(item));

  if (usable.length === 0) {
    return { stored: 0, duplicates: options.items.length };
  }

  const now = options.now ?? new Date();

  /*
   * Deduplication is left to the unique index rather than done with a lookup
   * first. A read-then-write would let two polls running at once both decide an
   * item is new; the index cannot be talked out of it. `onConflictDoNothing`
   * turns the collision into a row that simply is not inserted.
   */
  const inserted = await options.db
    .insert(schema.rawItems)
    .values(
      usable.map((item) => ({
        id: uuidv7(),
        tenantId: options.tenantId,
        sourceId: options.sourceId,
        externalId: item.externalId,
        url: item.url,
        title: item.title,
        author: item.author,
        content: item.content ?? "",
        contentHash: item.fingerprint,
        publishedAt: item.publishedAt,
        fetchedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [schema.rawItems.tenantId, schema.rawItems.contentHash],
    })
    .returning({ id: schema.rawItems.id });

  return {
    stored: inserted.length,
    duplicates: options.items.length - inserted.length,
  };
}

/**
 * An item with no words in it is not material.
 *
 * A feed that carries an empty placeholder every poll would otherwise fill the
 * table with rows that can never match anything, and each one costs an
 * embedding to find that out.
 */
function hasSomethingToSay(item: PollableItem): boolean {
  const hasText = item.content !== null && item.content.trim() !== "";
  const hasTitle = item.title !== null && item.title.trim() !== "";

  return hasText || hasTitle;
}

export interface PollSuccessOptions {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly sourceId: string;
  /** Validators to send back next time, when the server offered them. */
  readonly etag?: string | undefined;
  readonly lastModifiedHeader?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * A poll that worked.
 *
 * Clears the failure count outright rather than decrementing it: a source that
 * answers is working, and remembering that it had a bad Tuesday would keep it
 * on a slow schedule long after the reason had gone.
 */
export async function recordPollSuccess(options: PollSuccessOptions): Promise<void> {
  const now = options.now ?? new Date();

  await options.db
    .update(schema.sources)
    .set({
      status: "active",
      lastPolledAt: now,
      lastSucceededAt: now,
      consecutiveFailures: 0,
      lastErrorMessage: null,
      etag: options.etag ?? null,
      lastModifiedHeader: options.lastModifiedHeader ?? null,
      updatedAt: now,
    })
    .where(scopedById(schema.sources, options.tenantId, options.sourceId));
}

export interface PollFailureOptions {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly sourceId: string;
  /** The AppError code, so a pattern can be counted rather than read. */
  readonly code: string;
  readonly message: string;
  readonly httpStatus?: number | undefined;
  /** True once the failures have gone on long enough to stop scheduling it. */
  readonly isBroken: boolean;
  readonly now?: Date | undefined;
}

/**
 * A poll that did not.
 *
 * The failure is written twice on purpose: once onto the source as its current
 * state, and once into the error log as history. Current state answers "is this
 * working"; history answers "has it been flaky for a month", and a source
 * failing every third poll is a different problem from one that died on
 * Tuesday.
 */
export async function recordPollFailure(options: PollFailureOptions): Promise<void> {
  const now = options.now ?? new Date();
  const [current] = await options.db
    .select({ failures: schema.sources.consecutiveFailures })
    .from(schema.sources)
    .where(scopedById(schema.sources, options.tenantId, options.sourceId))
    .limit(1);

  if (current === undefined) {
    return;
  }

  await options.db
    .update(schema.sources)
    .set({
      status: options.isBroken ? "broken" : "active",
      lastPolledAt: now,
      lastErrorAt: now,
      lastErrorMessage: options.message,
      consecutiveFailures: current.failures + 1,
      updatedAt: now,
    })
    .where(eq(schema.sources.id, options.sourceId));

  await options.db.insert(schema.sourceErrors).values({
    id: uuidv7(),
    tenantId: options.tenantId,
    sourceId: options.sourceId,
    code: options.code,
    message: options.message,
    httpStatus: options.httpStatus ?? null,
    occurredAt: now,
  });
}
