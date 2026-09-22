/**
 * The job queue.
 *
 * On PostgreSQL rather than Redis, through pg-boss. The reason is the shape of
 * the product rather than any technical preference: this is software somebody
 * runs on their own server with `docker compose up`, and every additional
 * service in that file is one more thing that can be misconfigured, run out of
 * memory, or be left unbacked-up. The database is already there and already
 * backed up.
 *
 * pg-boss keeps its own tables in its own schema and creates them on first
 * start. Nothing here is in our migrations, which is why the schema does not
 * mention jobs at all.
 *
 * Two decisions worth stating, because both look like omissions otherwise:
 *
 * **One job per source at a time.** `singletonKey` is the source's identifier,
 * so a poll that is still running cannot have a second one queued behind it. A
 * slow feed on a short interval would otherwise pile up jobs faster than they
 * drain, and the pile would be indistinguishable from a working system until
 * the disk filled.
 *
 * **Few retries.** A source that cannot be read is recorded as a source
 * problem, not as a failed job — see `poll-source.ts`. So a job failing here
 * means something unexpected went wrong, and the small retry count is for a
 * database that blinked rather than for a feed that is down.
 */

import { getConfig } from "@mifluent/core";
import { PgBoss } from "pg-boss";

/** Queue names follow `<domain>:<action>`, the same as job names elsewhere. */
export const TICK_QUEUE = "sources:tick";
export const POLL_QUEUE = "sources:poll";
export const EMBED_QUEUE = "items:embed";

/**
 * Once a minute.
 *
 * The tick does not poll anything itself — it asks which sources are due and
 * queues those. Running it often is cheap, and it means a source added at
 * 10:00 is read at 10:01 rather than at the top of the next hour.
 */
export const TICK_CRON = "* * * * *";

/** Enough for a slow feed on a slow morning, short enough to notice a hang. */
const POLL_TIMEOUT_SECONDS = 120;

const RETRY_LIMIT = 2;

export interface PollJobData {
  readonly sourceId: string;
}

export interface EmbedJobData {
  readonly tenantId: string;
  readonly limit?: number;
}

export function createQueueClient(): PgBoss {
  return new PgBoss({
    connectionString: getConfig().DATABASE_URL,
    // Its own small pool. The collector's queries and its queue bookkeeping
    // compete for the same server, and giving the queue its own ceiling keeps
    // one from starving the other.
    max: 2,
    schema: "pgboss",
  });
}

/**
 * Declare the queues before anything is sent to them.
 *
 * pg-boss requires this since version 10 — sending to a queue that does not
 * exist fails rather than creating it, which is the right way round: a typo in
 * a queue name should be an error, not a new queue nobody reads.
 */
export async function declareQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(TICK_QUEUE);
  await boss.createQueue(POLL_QUEUE);
  await boss.createQueue(EMBED_QUEUE);
}

export async function queuePoll(boss: PgBoss, sourceId: string): Promise<void> {
  await boss.send(POLL_QUEUE, { sourceId } satisfies PollJobData, {
    singletonKey: sourceId,
    retryLimit: RETRY_LIMIT,
    retryBackoff: true,
    expireInSeconds: POLL_TIMEOUT_SECONDS,
  });
}

export async function queueEmbed(boss: PgBoss, tenantId: string, limit?: number): Promise<void> {
  await boss.send(EMBED_QUEUE, { tenantId, limit: limit ?? undefined } as EmbedJobData, {
    singletonKey: `embed:${tenantId}`,
    retryLimit: RETRY_LIMIT,
    retryBackoff: true,
    expireInSeconds: 600,
  });
}
