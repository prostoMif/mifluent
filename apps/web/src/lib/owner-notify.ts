/**
 * A short Telegram message to the instance owner — a payment that landed, a
 * refund to make by hand.
 *
 * Best effort: what triggered it is already recorded, so a message that does
 * not go out means the owner finds it in the daily report instead.
 */

import { getConfig } from "@mifluent/core";
import { createTelegramApi } from "@mifluent/delivery";
import { logger } from "./logger";

export async function tellOwner(text: string): Promise<void> {
  const { TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_CHAT_ID } = getConfig();
  if (TELEGRAM_BOT_TOKEN === undefined || OWNER_TELEGRAM_CHAT_ID === undefined) {
    logger.warn("owner.not_notified", { reason: "no owner chat configured" });
    return;
  }
  try {
    await createTelegramApi({ token: TELEGRAM_BOT_TOKEN }).sendMessage(OWNER_TELEGRAM_CHAT_ID, {
      text,
      parseMode: undefined,
    });
  } catch (error) {
    logger.warn("owner.not_notified", { cause: error });
  }
}
