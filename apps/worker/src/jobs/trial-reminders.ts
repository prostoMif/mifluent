/**
 * Tell people their free trial is ending, in the chat their digest goes to.
 *
 * Telegram only for now: email reminders need the same sender as the email
 * digest and come with it. A tenant without a bound chat is skipped — the
 * pricing page shows the trial's end date to anyone who looks.
 */

import { getConfig } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { stringsFor, type TelegramApi } from "@mifluent/delivery";
import type { TrialReminder } from "@mifluent/domain";
import { isNull } from "drizzle-orm";
import { logger } from "../runtime.js";

export async function sendTrialReminders(
  db: Queryable,
  telegram: TelegramApi,
  reminders: readonly TrialReminder[],
): Promise<number> {
  const pricingUrl = `${getConfig().APP_URL}/pricing`;
  let sent = 0;

  for (const reminder of reminders) {
    const profiles = await db
      .select({ delivery: schema.watchProfiles.delivery, facts: schema.watchProfiles.facts })
      .from(schema.watchProfiles)
      .where(
        scoped(schema.watchProfiles, reminder.tenantId, isNull(schema.watchProfiles.deletedAt)),
      );

    const chats = new Set(
      profiles.flatMap((profile) =>
        profile.delivery.telegramChatId === undefined
          ? []
          : [`${profile.delivery.telegramChatId}|${profile.facts.language ?? "en"}`],
      ),
    );

    for (const entry of chats) {
      const [chatId = "", language] = entry.split("|");
      try {
        await telegram.sendMessage(chatId, {
          text: stringsFor(language === "ru" ? "ru" : "en").trialEnding(
            reminder.daysLeft,
            pricingUrl,
          ),
          parseMode: undefined,
        });
        sent += 1;
      } catch (error) {
        // One unreachable chat must not stop the others' reminders.
        logger.warn("billing.trial_reminder_failed", { tenantId: reminder.tenantId, cause: error });
      }
    }
  }
  return sent;
}
