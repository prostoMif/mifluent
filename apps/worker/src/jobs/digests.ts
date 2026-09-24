/**
 * Digests on schedule: an hourly tick finds the profiles whose delivery hour
 * has come in their own timezone, builds each digest and sends it.
 */

import { getConfig } from "@mifluent/core";
import { deliverDigest } from "@mifluent/delivery";
import { findDueProfiles, listPendingTelegramDigests } from "@mifluent/digest";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { QUEUES, queueDelivery, queueProfileStep } from "../queue.js";
import { deliveryDefaults, getDatabase, getTelegramApi, logger } from "../runtime.js";
import { buildDigestNow } from "../steps.js";

const profileJobSchema = z.object({ tenantId: z.string().uuid(), profileId: z.string().uuid() });
const digestJobSchema = z.object({ tenantId: z.string().uuid(), digestId: z.string().uuid() });

export async function registerDigestJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.digestTick, async () => {
    const db = getDatabase();
    const due = await findDueProfiles(db, new Date(), deliveryDefaults());
    for (const profile of due) {
      await queueProfileStep(boss, QUEUES.digestBuild, profile);
    }

    // Anything built but not sent — a worker restart between the two, a
    // Telegram outage an hour ago — is picked up again here.
    for (const pending of await listPendingTelegramDigests(db)) {
      await queueDelivery(boss, pending);
    }
    logger.info("digests.ticked", { due: due.length });
  });

  await boss.work(QUEUES.digestBuild, async ([job]) => {
    if (job === undefined) return;
    const ref = profileJobSchema.parse(job.data);

    const digest = await buildDigestNow(getDatabase(), ref, new Date());
    logger.info("digest.built", { ...ref, ...digest });
    if (digest.isNew && digest.channel === "telegram") {
      await queueDelivery(boss, { tenantId: ref.tenantId, digestId: digest.digestId });
    }
  });

  await boss.work(QUEUES.digestDeliver, async ([job]) => {
    if (job === undefined) return;
    const ref = digestJobSchema.parse(job.data);
    const api = getTelegramApi();

    if (api === undefined) {
      logger.warn("digest.delivery_skipped", { ...ref, reason: "telegram_not_configured" });
      return;
    }

    await deliverDigest({
      db: getDatabase(),
      api,
      logger,
      ref,
      appUrl: getConfig().APP_URL,
      timezone: deliveryDefaults().timezone,
    });
  });
}
