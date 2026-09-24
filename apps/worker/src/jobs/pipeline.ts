/**
 * The cascade after fetching: embed a tenant's new material, then for each of
 * its profiles select and extract. Each step queues the next, so a slow model
 * never holds up polling and every step can be retried on its own.
 */

import { listTenantProfiles } from "@mifluent/pipeline";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { QUEUES, queueDelivery, queueEmbed, queueProfileStep } from "../queue.js";
import { getDatabase, logger } from "../runtime.js";
import { buildUrgentDigests, embedTenant, extractProfile, selectProfile } from "../steps.js";

const tenantJobSchema = z.object({ tenantId: z.string().uuid() });
const profileJobSchema = z.object({ tenantId: z.string().uuid(), profileId: z.string().uuid() });

export async function registerPipelineJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.itemsEmbed, async ([job]) => {
    if (job === undefined) return;
    const { tenantId } = tenantJobSchema.parse(job.data);
    const db = getDatabase();

    const result = await embedTenant(db, tenantId);
    if (result.hasMore) {
      await queueEmbed(boss, tenantId);
      return;
    }

    for (const profile of await listTenantProfiles(db, tenantId)) {
      await queueProfileStep(boss, QUEUES.pipelineSelect, profile);
    }
  });

  await boss.work(QUEUES.pipelineSelect, async ([job]) => {
    if (job === undefined) return;
    const ref = profileJobSchema.parse(job.data);

    const result = await selectProfile(getDatabase(), ref);
    if (typeof result === "string") {
      logger.info("pipeline.select_skipped", { ...ref, reason: result });
      return;
    }
    if (result.eventsCreated > 0) {
      await queueProfileStep(boss, QUEUES.pipelineExtract, ref);
    }
  });

  await boss.work(QUEUES.pipelineExtract, async ([job]) => {
    if (job === undefined) return;
    const ref = profileJobSchema.parse(job.data);
    const db = getDatabase();

    const result = await extractProfile(db, ref);
    if (typeof result === "string") {
      logger.info("pipeline.extract_skipped", { ...ref, reason: result });
      return;
    }

    for (const digest of await buildUrgentDigests(db, ref, result)) {
      if (digest.isNew && digest.channel === "telegram") {
        await queueDelivery(boss, { tenantId: ref.tenantId, digestId: digest.digestId });
      }
    }
  });
}
