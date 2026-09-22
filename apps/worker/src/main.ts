/**
 * The collector.
 *
 * Two modes, one code path:
 *
 *   npm run poll     — do one round now and stop. For a person at a terminal
 *                      asking "what happens if I run it right now".
 *   npm run worker   — stay up, tick every minute, poll what is due.
 *
 * They share everything below the mode check on purpose. A debugging command
 * that runs different code from the thing it is debugging is worse than no
 * command at all.
 */

import { listActiveSources, type PollableSource } from "@mifluent/domain";
import { isDueForPoll } from "@mifluent/sources";
import type { PgBoss } from "pg-boss";
import { processEmbedJob } from "./embed-item.js";
import { pollSource } from "./poll-source.js";
import {
  createQueueClient,
  declareQueues,
  EMBED_QUEUE,
  type EmbedJobData,
  POLL_QUEUE,
  type PollJobData,
  queuePoll,
  TICK_CRON,
  TICK_QUEUE,
} from "./queue.js";
import { getDatabase, logger } from "./runtime.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Which sources want reading, and why that is a decision made in one place. */
async function findDueSources(now: Date): Promise<PollableSource[]> {
  const sources = await listActiveSources(getDatabase());
  return sources.filter((source) => isDueForPoll(source, now));
}

/**
 * One round, done inline without the queue.
 *
 * Sequential rather than parallel: this is a handful of feeds run by hand, and
 * being visibly polite beats being fast.
 */
async function runOnce(): Promise<void> {
  const now = new Date();
  const due = await findDueSources(now);

  say(`${due.length} source(s) due.`);

  for (const source of due) {
    const outcome = await pollSource(source, now);

    say(
      outcome.result === "stored"
        ? `  ${outcome.label}: ${outcome.stored} new, ${outcome.duplicates} already seen`
        : `  ${outcome.label}: ${outcome.result}${
            outcome.message === undefined ? "" : ` — ${outcome.message}`
          }`,
    );
  }
}

async function findSource(sourceId: string): Promise<PollableSource | undefined> {
  const sources = await listActiveSources(getDatabase());
  return sources.find((source) => source.id === sourceId);
}

async function runForever(): Promise<void> {
  const boss = createQueueClient();

  boss.on("error", (error: unknown) => {
    // pg-boss reports background trouble here — a lost connection, a failed
    // maintenance pass. Left unhandled it would take the process down.
    logger.error("queue.failed", { cause: error });
  });

  await boss.start();
  await declareQueues(boss);

  await boss.work(TICK_QUEUE, async () => {
    const due = await findDueSources(new Date());

    for (const source of due) {
      await queuePoll(boss, source.id);
    }

    logger.info("sources.tick", { due: due.length });
  });

  await boss.work<PollJobData>(POLL_QUEUE, async (jobs) => {
    const [job] = jobs;

    if (job === undefined) {
      return;
    }

    /*
     * Read fresh rather than carried in the job. A job can sit in the queue for
     * a while, and by the time it runs the source may have been paused, edited
     * or removed — acting on the copy taken when it was queued would poll an
     * address nobody wants read any more.
     */
    const source = await findSource(job.data.sourceId);

    if (source === undefined) {
      logger.info("sources.poll_skipped", { sourceId: job.data.sourceId });
      return;
    }

    await pollSource(source, new Date());
  });

  await boss.work<EmbedJobData>(EMBED_QUEUE, async (jobs) => {
    const [job] = jobs;

    if (job === undefined) {
      return;
    }

    const { tenantId, limit } = job.data;
    const db = getDatabase();

    try {
      const result = await processEmbedJob(db, tenantId, limit);
      logger.info("items.embedded", { tenantId, ...result });
    } catch (error) {
      logger.error("items.embed_failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });

  await boss.schedule(TICK_QUEUE, TICK_CRON);

  logger.info("worker.started", { tick: TICK_CRON });
  await waitForShutdown(boss);
}

/**
 * Stop when asked, and finish what is in hand first.
 *
 * A container is stopped with a signal, and a collector killed mid-poll leaves
 * a job marked as running that nothing will ever finish. pg-boss releases those
 * eventually, but "eventually" is a source that looks stuck for no reason.
 */
async function waitForShutdown(boss: PgBoss): Promise<void> {
  await new Promise<void>((resolve) => {
    const stop = (signal: string): void => {
      logger.info("worker.stopping", { signal });
      resolve();
    };

    process.once("SIGINT", () => {
      stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      stop("SIGTERM");
    });
  });

  await boss.stop({ graceful: true });
}

const isOneShot = process.argv.includes("--once");

(isOneShot ? runOnce() : runForever())
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.error("worker.failed", { cause: error });
    process.exit(1);
  });
