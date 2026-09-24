/**
 * The collector.
 *
 * Two modes, one code path:
 *
 *   npm run poll     — do one round of polling now and stop. For a person at
 *                      a terminal asking "what happens if I run it right now".
 *   npm run worker   — stay up: poll what is due every minute, run the
 *                      cascade on what arrives, send digests on schedule.
 *
 * They share everything below the mode check on purpose. A debugging command
 * that runs different code from the thing it is debugging is worse than no
 * command at all.
 */

import { getConfig } from "@mifluent/core";
import { listActiveSources } from "@mifluent/domain";
import { isDueForPoll } from "@mifluent/sources";
import type { PgBoss } from "pg-boss";
import { startHeartbeat } from "./heartbeat.js";
import { registerDigestJobs } from "./jobs/digests.js";
import { registerMaintenanceJobs } from "./jobs/maintenance.js";
import { registerOnboardingJobs } from "./jobs/onboarding.js";
import { registerPipelineJobs } from "./jobs/pipeline.js";
import { registerSourceJobs } from "./jobs/sources.js";
import { pollSource } from "./poll-source.js";
import {
  createQueueClient,
  DIGEST_TICK_CRON,
  declareQueues,
  MAINTENANCE_CRON,
  QUEUES,
  SOURCES_TICK_CRON,
} from "./queue.js";
import { getDatabase, getTelegramApi, logger } from "./runtime.js";
import { startTelegramPolling } from "./telegram-polling.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * One round, done inline without the queue.
 *
 * Sequential rather than parallel: this is a handful of feeds run by hand, and
 * being visibly polite beats being fast.
 */
async function runOnce(): Promise<void> {
  const now = new Date();
  const db = getDatabase();
  const due = (await listActiveSources(db)).filter((source) => isDueForPoll(source, now));

  say(`${due.length} source(s) due.`);

  for (const source of due) {
    const outcome = await pollSource({ db, source, now });
    say(
      outcome.result === "stored"
        ? `  ${outcome.label}: ${outcome.stored} new, ${outcome.duplicates} already seen`
        : `  ${outcome.label}: ${outcome.result}${outcome.message === undefined ? "" : ` — ${outcome.message}`}`,
    );
  }
}

async function runForever(): Promise<void> {
  const config = getConfig();
  const boss = createQueueClient();

  boss.on("error", (error: unknown) => {
    // pg-boss reports background trouble here — a lost connection, a failed
    // maintenance pass. Left unhandled it would take the process down.
    logger.error("queue.failed", { cause: error });
  });

  await boss.start();
  await declareQueues(boss);

  await registerSourceJobs(boss);
  await registerPipelineJobs(boss);
  await registerDigestJobs(boss);
  await registerOnboardingJobs(boss);
  await registerMaintenanceJobs(boss);

  await boss.schedule(QUEUES.sourcesTick, SOURCES_TICK_CRON);
  await boss.schedule(QUEUES.digestTick, DIGEST_TICK_CRON);
  await boss.schedule(QUEUES.maintenanceDaily, MAINTENANCE_CRON);

  const stopHeartbeat = startHeartbeat(config.WORKER_HEARTBEAT_FILE);
  const telegram = getTelegramApi();
  const stopPolling =
    config.TELEGRAM_POLLING && telegram !== undefined
      ? startTelegramPolling(telegram)
      : () => undefined;

  logger.info("worker.started", { features: config.features });
  await waitForShutdown(boss);

  stopPolling();
  stopHeartbeat();
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

try {
  await (process.argv.includes("--once") ? runOnce() : runForever());
  process.exit(0);
} catch (error) {
  logger.error("worker.failed", { cause: error });
  process.exit(1);
}
