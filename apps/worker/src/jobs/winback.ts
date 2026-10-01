/**
 * One message to a customer whose paid time ran out a month ago: a personal
 * code, −40% for two months, valid a week. Sent once per tenant, ever.
 *
 * Telegram only, like the trial reminders. A tenant with no bound chat is not
 * given a code — it would never see it — and stays a candidate until the
 * 60-day edge in `listWinbackCandidates` passes.
 */

import { getConfig } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { stringsFor, type TelegramApi } from "@mifluent/delivery";
import { issueWinbackCode, listWinbackCandidates } from "@mifluent/domain";
import { isNull } from "drizzle-orm";
import { logger } from "../runtime.js";

export async function sendWinbacks(
  db: Queryable,
  telegram: TelegramApi,
  now: Date,
): Promise<number> {
  const pricingUrl = `${getConfig().APP_URL}/pricing`;
  let sent = 0;

  for (const tenantId of await listWinbackCandidates(db, now)) {
    const [chat] = await db
      .select({ delivery: schema.watchProfiles.delivery, facts: schema.watchProfiles.facts })
      .from(schema.watchProfiles)
      .where(scoped(schema.watchProfiles, tenantId, isNull(schema.watchProfiles.deletedAt)))
      .then((profiles) => profiles.filter((profile) => profile.delivery.telegramChatId != null));
    const chatId = chat?.delivery.telegramChatId;
    if (chat === undefined || chatId == null) continue;

    const issued = await issueWinbackCode(db, tenantId, now);
    if (issued === undefined) continue;
    try {
      await telegram.sendMessage(chatId, {
        text: stringsFor(chat.facts.language === "ru" ? "ru" : "en").winback(
          issued.code,
          pricingUrl,
        ),
      });
      sent += 1;
    } catch (error) {
      // The code stays issued and the tenant marked: a second attempt could
      // send it twice, and "never more than once" matters more.
      logger.warn("billing.winback_failed", { tenantId, cause: error });
    }
  }
  return sent;
}
