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
 * The cascade as jobs, each handing on to the next:
 *
 *   sources:tick → sources:poll → items:embed → pipeline:select
 *     → pipeline:extract → (urgent) digest:deliver
 *   digest:tick → digest:build → digest:deliver
 *
 * **One job per key at a time.** Per-source and per-profile queues use the
 * `stately` policy with a singleton key: at most one queued and one running
 * job per source or profile. A slow feed on a short interval would otherwise
 * pile up jobs faster than they drain. (A `singletonKey` on a `standard` queue
 * does nothing in pg-boss 10+, which is how the first version of this file
 * came to have no protection at all.)
 *
 * **Few retries.** A source that cannot be read is recorded as a source
 * problem, not as a failed job — see `poll-source.ts`. A job failing here
 * means something unexpected went wrong, and the small retry count is for a
 * database that blinked rather than for a feed that is down.
 */

import { getConfig } from "@mifluent/core";
import { QUEUES } from "@mifluent/domain";
import { PgBoss, type Queue } from "pg-boss";

export { QUEUES };

/** Every minute: finds due sources. Cheap, and a new source is read within a minute. */
export const SOURCES_TICK_CRON = "* * * * *";

/** On the hour: digests go out at a whole hour in each reader's zone. */
export const DIGEST_TICK_CRON = "0 * * * *";

/** 03:15 UTC: pruning, when nobody is waiting for a digest. */
export const MAINTENANCE_CRON = "15 3 * * *";

const RETRY_LIMIT = 2;

const STATELY: Omit<Queue, "name"> = { policy: "stately" };

const QUEUE_OPTIONS: Readonly<Record<string, Omit<Queue, "name">>> = {
  [QUEUES.sourcesPoll]: { ...STATELY, expireInSeconds: 120 },
  [QUEUES.itemsEmbed]: { ...STATELY, expireInSeconds: 900 },
  [QUEUES.pipelineSelect]: { ...STATELY, expireInSeconds: 900 },
  [QUEUES.pipelineExtract]: { ...STATELY, expireInSeconds: 1_800 },
  [QUEUES.digestBuild]: { ...STATELY, expireInSeconds: 300 },
  [QUEUES.digestDeliver]: { ...STATELY, expireInSeconds: 300 },
  // A person is watching a progress screen for these two.
  [QUEUES.discoveryRun]: { expireInSeconds: 300, retryLimit: 0 },
  [QUEUES.profileFirstRun]: { ...STATELY, expireInSeconds: 1_800, retryLimit: 0 },
};

export interface SourceJob {
  readonly sourceId: string;
}

export interface TenantJob {
  readonly tenantId: string;
}

export interface ProfileJob {
  readonly tenantId: string;
  readonly profileId: string;
}

export interface DigestJob {
  readonly tenantId: string;
  readonly digestId: string;
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
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, {
      retryLimit: RETRY_LIMIT,
      retryBackoff: true,
      ...QUEUE_OPTIONS[name],
    });
  }
}

export async function queuePoll(boss: PgBoss, sourceId: string): Promise<void> {
  await boss.send(QUEUES.sourcesPoll, { sourceId } satisfies SourceJob, { singletonKey: sourceId });
}

export async function queueEmbed(boss: PgBoss, tenantId: string): Promise<void> {
  await boss.send(QUEUES.itemsEmbed, { tenantId } satisfies TenantJob, { singletonKey: tenantId });
}

export async function queueProfileStep(
  boss: PgBoss,
  queue: typeof QUEUES.pipelineSelect | typeof QUEUES.pipelineExtract | typeof QUEUES.digestBuild,
  job: ProfileJob,
): Promise<void> {
  await boss.send(queue, job satisfies ProfileJob, { singletonKey: job.profileId });
}

export async function queueDelivery(boss: PgBoss, job: DigestJob): Promise<void> {
  await boss.send(QUEUES.digestDeliver, job satisfies DigestJob, { singletonKey: job.digestId });
}
