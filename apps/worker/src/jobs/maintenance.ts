/**
 * Once a day: prune what the pipeline leaves behind.
 */

import { pruneExpiredBindings } from "@mifluent/delivery";
import { pruneExpiredMaterial, pruneRejections } from "@mifluent/pipeline";
import type { PgBoss } from "pg-boss";
import { QUEUES } from "../queue.js";
import { getDatabase, logger } from "../runtime.js";

export async function registerMaintenanceJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.maintenanceDaily, async () => {
    const db = getDatabase();
    const now = new Date();

    const rejections = await pruneRejections(db, now);
    const material = await pruneExpiredMaterial(db, now);
    await pruneExpiredBindings(db, now);

    // Raw material only. Events, digests, the action log and decisions have no
    // TTL — see `pruneExpiredMaterial`.
    logger.info("maintenance.completed", { rejections, ...material });
  });
}
