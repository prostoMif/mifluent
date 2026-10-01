/**
 * Maintenance jobs: daily owner report, instant alerts, healthchecks, cleanup.
 */

import { getConfig } from "@mifluent/core";
import { pruneExpiredBindings } from "@mifluent/delivery";
import {
  closeEndedTrials,
  expirePaidPlans,
  generateDailyOwnerReport,
  listTrialReminders,
} from "@mifluent/domain";
import {
  deleteExpiredPendingOnboardings,
  deleteOldConsumedPendingOnboardings,
} from "@mifluent/domain/onboarding/pending";
import { pruneExpiredMaterial, pruneRejections } from "@mifluent/pipeline";
import type { PgBoss } from "pg-boss";
import { QUEUES } from "../queue.js";
import { getDatabase, getTelegramApi, logger } from "../runtime.js";
import { sendTrialReminders } from "./trial-reminders.js";

export async function registerMaintenanceJobs(boss: PgBoss): Promise<void> {
  // Daily owner report at 08:00 UTC
  await boss.work(QUEUES.ownerDailyReport, async () => {
    await sendDailyOwnerReport();
  });

  // Alert checks every 5 minutes
  await boss.work(QUEUES.alertCheck, async () => {
    await checkAlerts();
  });

  // Daily at 03:00 UTC: retention, onboarding leftovers, billing.
  await boss.work(QUEUES.maintenanceDaily, async () => {
    await pruneRetainedData();
    await cleanupPendingOnboardings();
    await settleBilling();
  });
}

/**
 * What the pipeline leaves behind: rejections after two weeks, raw material
 * after the plan's retention period, expired Telegram binding codes. History
 * — events, cards, decisions — is never touched here (TASK-017).
 */
async function pruneRetainedData(): Promise<void> {
  const db = getDatabase();
  const now = new Date();

  const rejections = await pruneRejections(db, now);
  const items = await pruneExpiredMaterial(db, now);
  await pruneExpiredBindings(db, now);
  logger.info("maintenance.completed", { rejections, items });
}

/** Paid time that ran out, trials that ended, and reminders before a trial ends. */
async function settleBilling(): Promise<void> {
  const db = getDatabase();
  const now = new Date();

  const downgraded = await expirePaidPlans(db, now);
  const trialsClosed = await closeEndedTrials(db, now);
  const reminders = await listTrialReminders(db, now);
  const telegram = getTelegramApi();
  const sent = telegram === undefined ? 0 : await sendTrialReminders(db, telegram, reminders);

  logger.info("billing.settled", {
    downgraded: downgraded.length,
    trialsClosed: trialsClosed.length,
    reminders: reminders.length,
    remindersSent: sent,
  });
}

async function sendDailyOwnerReport(): Promise<void> {
  const config = getConfig();
  const ownerChatId = config.OWNER_TELEGRAM_CHAT_ID;
  const telegramApi = getTelegramApi();

  if (!ownerChatId || !telegramApi) return;

  const db = getDatabase();
  const report = await generateDailyOwnerReport(db);

  try {
    await telegramApi.sendMessage(ownerChatId, { text: report, parseMode: "Markdown" });
    logger.info("owner.daily_report_sent", {});
  } catch (thrown) {
    logger.warn("owner.daily_report_failed", { cause: thrown });
  }
}

async function checkAlerts(): Promise<void> {
  const config = getConfig();
  const ownerChatId = config.OWNER_TELEGRAM_CHAT_ID;
  const telegramApi = getTelegramApi();

  if (!ownerChatId || !telegramApi) return;

  // This is a stub — actual alert logic would check:
  // 1. Cost cap reached
  // 2. Delivery failures (permanent failures)
  // 3. Discovery failures during onboarding
  // For now, just log that checks ran
  logger.debug("alerts.checked", {});
}

async function cleanupPendingOnboardings(): Promise<void> {
  const db = getDatabase();

  // Delete expired pending onboardings (older than 24h)
  const expiredCount = await deleteExpiredPendingOnboardings(db);
  if (expiredCount > 0) {
    logger.info("maintenance.expired_pending_onboardings_deleted", { count: expiredCount });
  }

  // Delete consumed pending onboardings older than 24h
  const consumedCount = await deleteOldConsumedPendingOnboardings(db);
  if (consumedCount > 0) {
    logger.info("maintenance.consumed_pending_onboardings_deleted", { count: consumedCount });
  }
}

// Track alert cooldowns to avoid spam (once per hour per alert type)
const alertCooldowns = new Map<string, number>();

export async function sendInstantAlert(
  type: "cost_cap" | "delivery_failed" | "discovery_failed",
  details: string,
): Promise<void> {
  const config = getConfig();
  const ownerChatId = config.OWNER_TELEGRAM_CHAT_ID;
  const telegramApi = getTelegramApi();

  if (!ownerChatId || !telegramApi) return;

  const now = Date.now();
  const cooldownKey = type;
  const lastSent = alertCooldowns.get(cooldownKey) ?? 0;

  if (now - lastSent < 60 * 60 * 1000) {
    return; // Cooldown active
  }

  alertCooldowns.set(cooldownKey, now);

  const message = `🚨 *Mifluent Alert* — ${type}\n${details}`;

  try {
    await sendMessageWithRetry(ownerChatId, { text: message, parseMode: "Markdown" });
    logger.info("owner.instant_alert_sent", { type });
  } catch (thrown) {
    logger.warn("owner.instant_alert_failed", { type, cause: thrown });
  }
}

async function sendMessageWithRetry(
  chatId: string,
  message: { text: string; parseMode: "Markdown" | "HTML" },
  retries = 3,
  baseDelay = 5000,
): Promise<void> {
  const api = getTelegramApi();
  if (!api) throw new Error("Telegram not configured");

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await api.sendMessage(chatId, message);
      return;
    } catch (thrown) {
      if (attempt === retries - 1) throw thrown;
      await new Promise((resolve) => setTimeout(resolve, baseDelay * (attempt + 1)));
    }
  }
}
