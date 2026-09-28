/**
 * Maintenance jobs: daily owner report, instant alerts, healthchecks.
 */

import { getConfig } from "@mifluent/core";
import { generateDailyOwnerReport } from "@mifluent/domain";
import type { PgBoss } from "pg-boss";
import { QUEUES } from "../queue.js";
import { getDatabase, getTelegramApi, logger } from "../runtime.js";

export async function registerMaintenanceJobs(boss: PgBoss): Promise<void> {
  // Daily owner report at 08:00 UTC
  await boss.work(QUEUES.ownerDailyReport, async () => {
    await sendDailyOwnerReport();
  });

  // Alert checks every 5 minutes
  await boss.work(QUEUES.alertCheck, async () => {
    await checkAlerts();
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
