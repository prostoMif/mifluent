/**
 * The public radar's side of the worker: drafts for the owner after the
 * radar tenant's events are extracted, and the Monday round-up.
 */

import { getConfig } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { sendRadarDraft, sendWeeklyRadarDraft } from "@mifluent/delivery";
import { draftRadarPosts } from "@mifluent/domain";
import type { PgBoss } from "pg-boss";
import { QUEUES } from "../queue.js";
import { getDatabase, getTelegramApi, logger } from "../runtime.js";

export function isRadarTenant(tenantId: string): boolean {
  return getConfig().RADAR_TENANT_ID === tenantId;
}

/** Draft posts from freshly extracted radar events and send them to the owner. */
export async function draftRadarEvents(db: Queryable, eventIds: readonly string[]): Promise<void> {
  const config = getConfig();
  const telegram = getTelegramApi();
  const radarTenantId = config.RADAR_TENANT_ID;
  const ownerChatId = config.OWNER_TELEGRAM_CHAT_ID;
  if (radarTenantId === undefined || ownerChatId === undefined || telegram === undefined) return;

  const drafts = await draftRadarPosts(db, radarTenantId, eventIds, new Date());
  for (const draft of drafts) {
    try {
      await sendRadarDraft(telegram, ownerChatId, draft);
    } catch (error) {
      logger.warn("radar.draft_not_sent", { postId: draft.postId, cause: error });
    }
  }
  if (drafts.length > 0) logger.info("radar.drafted", { drafts: drafts.length });
}

export async function registerRadarJobs(boss: PgBoss): Promise<void> {
  await boss.work(QUEUES.radarWeekly, async () => {
    const config = getConfig();
    const telegram = getTelegramApi();
    if (
      config.RADAR_TENANT_ID === undefined ||
      config.OWNER_TELEGRAM_CHAT_ID === undefined ||
      telegram === undefined
    ) {
      return;
    }
    for (const language of ["en", "ru"] as const) {
      await sendWeeklyRadarDraft(
        getDatabase(),
        telegram,
        config.OWNER_TELEGRAM_CHAT_ID,
        config.RADAR_TENANT_ID,
        language,
        new Date(),
      );
    }
  });
}
