/**
 * Digests on schedule: an hourly tick finds the profiles whose delivery hour
 * has come in their own timezone, builds each digest and sends it.
 *
 * Monthly market report: runs on the 1st of each month at 09:00 UTC,
 * builds a report for the previous calendar month for each Pro profile,
 * and delivers it via Telegram (short) and email (full).
 */

import { getConfig } from "@mifluent/core";
import { deliverDigest } from "@mifluent/delivery";
import {
  buildMonthlyReport,
  findDueProfiles,
  listPendingEmailDigests,
  listPendingTelegramDigests,
  persistMonthlyReport,
} from "@mifluent/digest";
import { findTenantPlan } from "@mifluent/domain";
import { listRunnableProfiles } from "@mifluent/pipeline";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import {
  QUEUES,
  queueDelivery,
  queueMonthlyReportBuild,
  queueMonthlyReportDeliver,
  queueProfileStep,
} from "../queue.js";
import {
  createPipelineLlm,
  deliveryDefaults,
  getDatabase,
  getTelegramApi,
  logger,
} from "../runtime.js";
import { buildDigestNow } from "../steps.js";

const profileJobSchema = z.object({ tenantId: z.string().uuid(), profileId: z.string().uuid() });
const digestJobSchema = z.object({ tenantId: z.string().uuid(), digestId: z.string().uuid() });
const monthlyReportJobSchema = z.object({
  tenantId: z.string().uuid(),
  profileId: z.string().uuid(),
  month: z.string(),
  digestId: z.string().uuid().optional(),
});

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
    for (const pending of await listPendingEmailDigests(db)) {
      await queueDelivery(boss, pending);
    }
    logger.info("digests.ticked", { due: due.length });
  });

  await boss.work(QUEUES.digestBuild, async ([job]) => {
    if (job === undefined) return;
    const ref = profileJobSchema.parse(job.data);

    const digest = await buildDigestNow(getDatabase(), ref, new Date());
    logger.info("digest.built", { ...ref, ...digest });
    if (digest.isNew && (digest.channel === "telegram" || digest.channel === "email")) {
      await queueDelivery(boss, { tenantId: ref.tenantId, digestId: digest.digestId });
    }
  });

  await boss.work(QUEUES.digestDeliver, async ([job]) => {
    if (job === undefined) return;
    const ref = digestJobSchema.parse(job.data);
    const api = getTelegramApi();

    const outcome = await deliverDigest({
      db: getDatabase(),
      telegramApi: api,
      logger,
      ref,
      appUrl: getConfig().APP_URL,
      timezone: deliveryDefaults().timezone,
    });

    // Schedule retry if needed
    if (outcome.retryAfterMinutes !== undefined) {
      await boss.send(
        QUEUES.digestDeliver,
        { tenantId: ref.tenantId, digestId: ref.digestId } satisfies DigestJob,
        { singletonKey: ref.digestId, startAfter: outcome.retryAfterMinutes * 60 * 1000 },
      );
    }
  });

  // Monthly report tick: runs on the 1st of each month, finds Pro profiles
  // and queues a monthly report build for each.
  await boss.work(QUEUES.monthlyReportTick, async () => {
    const db = getDatabase();
    const profiles = await listRunnableProfiles(db);
    let queued = 0;

    for (const profile of profiles) {
      const { limits } = await findTenantPlan(db, profile.tenantId);
      // Only Pro and Team get monthly reports (maxTargets > 3)
      if (limits.maxTargets <= 3) continue;

      // Calculate previous month
      const now = new Date();
      const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const monthKey = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, "0")}`;

      await queueMonthlyReportBuild(boss, {
        tenantId: profile.tenantId,
        profileId: profile.profileId,
        month: monthKey,
      });
      queued++;
    }

    logger.info("monthly_report.ticked", { queued });
  });

  // Monthly report build: builds the report with LLM intro and persists it
  await boss.work(QUEUES.monthlyReportBuild, async ([job]) => {
    if (job === undefined) return;
    const ref = monthlyReportJobSchema.parse(job.data);

    const db = getDatabase();
    const llm = createPipelineLlm(db);
    if (llm === undefined) {
      logger.warn("monthly_report.llm_not_configured", { ...ref });
      return;
    }

    const report = await buildMonthlyReport({
      db,
      tenantId: ref.tenantId,
      profileId: ref.profileId,
      month: ref.month,
      llm,
    });

    const digestId = await persistMonthlyReport(db, ref.tenantId, ref.profileId, report);
    logger.info("monthly_report.built", { ...ref, digestId });

    // Queue delivery
    await queueMonthlyReportDeliver(boss, { ...ref, digestId });
  });

  // Monthly report deliver: sends the report via Telegram and email
  await boss.work(QUEUES.monthlyReportDeliver, async ([job]) => {
    if (job === undefined) return;
    const ref = monthlyReportJobSchema.parse(job.data);

    // The deliver job must have a digestId (queued by the build job)
    if (ref.digestId === undefined) {
      logger.warn("monthly_report.deliver_no_digest_id", { ...ref });
      return;
    }

    // Narrow the type to include required digestId
    const deliverRef = { ...ref, digestId: ref.digestId } as z.infer<
      typeof monthlyReportJobSchema
    > & { digestId: string };
    await deliverMonthlyReport(deliverRef, boss);
  });
}

async function deliverMonthlyReport(
  ref: z.infer<typeof monthlyReportJobSchema> & { digestId: string },
  boss: PgBoss,
): Promise<void> {
  const db = getDatabase();
  const api = getTelegramApi();

  // Load the persisted report digest
  const { loadDigestView } = await import("@mifluent/digest");
  const digest = await loadDigestView(db, ref.tenantId, ref.digestId);
  if (digest === undefined) {
    logger.warn("monthly_report.digest_not_found", { ...ref });
    return;
  }

  // Deliver via Telegram (short version with button to full report)
  if (digest.channel === "telegram" || digest.channel === "web_only") {
    await deliverChannel(ref, boss, digest, "telegram", api);
  }

  // Deliver via email (full version)
  if (digest.channel === "email") {
    await deliverChannel(ref, boss, digest, "email", api);
  }
}

async function deliverChannel(
  ref: z.infer<typeof monthlyReportJobSchema> & { digestId: string },
  boss: PgBoss,
  _digest: Awaited<ReturnType<typeof import("@mifluent/digest").loadDigestView>>,
  _channel: "telegram" | "email",
  api: ReturnType<typeof import("../runtime.js").getTelegramApi>,
): Promise<void> {
  const { deliverDigest } = await import("@mifluent/delivery");
  const outcome = await deliverDigest({
    db: getDatabase(),
    telegramApi: api,
    logger,
    ref: { tenantId: ref.tenantId, digestId: ref.digestId },
    appUrl: getConfig().APP_URL,
    timezone: deliveryDefaults().timezone,
  });

  if (outcome.retryAfterMinutes !== undefined) {
    await boss.send(
      QUEUES.monthlyReportDeliver,
      {
        tenantId: ref.tenantId,
        profileId: ref.profileId,
        month: ref.month,
        digestId: ref.digestId,
      } satisfies MonthlyReportDeliverJob,
      { singletonKey: ref.digestId, startAfter: outcome.retryAfterMinutes * 60 * 1000 },
    );
  }
}

interface DigestJob {
  readonly tenantId: string;
  readonly digestId: string;
}

interface MonthlyReportDeliverJob {
  readonly tenantId: string;
  readonly profileId: string;
  readonly month: string;
  readonly digestId: string;
}
