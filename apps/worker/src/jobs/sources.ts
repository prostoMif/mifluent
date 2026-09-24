/**
 * Polling: which sources are due, and reading each one.
 */

import { listActiveSources } from "@mifluent/domain";
import { isDueForPoll } from "@mifluent/sources";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { pollSource } from "../poll-source.js";
import { QUEUES, queueEmbed, queuePoll } from "../queue.js";
import { getDatabase, logger } from "../runtime.js";

const sourceJobSchema = z.object({ sourceId: z.string().uuid() });

export async function registerSourceJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.sourcesTick, async () => {
    const now = new Date();
    const due = (await listActiveSources(getDatabase())).filter((source) =>
      isDueForPoll(source, now),
    );

    for (const source of due) {
      await queuePoll(boss, source.id);
    }
    logger.debug("sources.ticked", { due: due.length });
  });

  await boss.work(QUEUES.sourcesPoll, async ([job]) => {
    if (job === undefined) return;
    const { sourceId } = sourceJobSchema.parse(job.data);

    /*
     * Read fresh rather than carried in the job. A job can sit in the queue for
     * a while, and by the time it runs the source may have been paused, edited
     * or removed — acting on the copy taken when it was queued would poll an
     * address nobody wants read any more.
     */
    const source = (await listActiveSources(getDatabase())).find(
      (candidate) => candidate.id === sourceId,
    );
    if (source === undefined) {
      logger.info("sources.poll_skipped", { sourceId });
      return;
    }

    const outcome = await pollSource({ db: getDatabase(), source, now: new Date() });
    if (outcome.stored > 0) {
      await queueEmbed(boss, source.tenantId);
    }
  });
}
