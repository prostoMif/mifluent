/**
 * Sending one built digest to its Telegram chat.
 *
 * The failure reason stored on the digest is a short code, never Telegram's
 * text: an error from an API called with a token in its path is exactly the
 * kind of string that should not be written anywhere a person can read it.
 */

import { type Logger, toAppError } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import {
  type DigestRef,
  loadDigestView,
  markDigestDelivered,
  markDigestFailed,
} from "@mifluent/digest";
import { renderDigest } from "./render.js";
import type { TelegramApi } from "./telegram-api.js";

export interface DeliverOptions {
  readonly db: Queryable;
  readonly api: TelegramApi;
  readonly logger: Logger;
  readonly ref: DigestRef;
  readonly appUrl: string;
  readonly timezone: string;
  readonly now?: Date | undefined;
}

export type DeliveryOutcome = "delivered" | "not_bound" | "failed" | "missing";

export async function deliverDigest(options: DeliverOptions): Promise<DeliveryOutcome> {
  const { db, ref, logger } = options;
  const digest = await loadDigestView(db, ref.tenantId, ref.digestId);

  if (digest === undefined) return "missing";

  if (digest.telegramChatId === null) {
    await markDigestFailed(db, ref, "telegram_not_bound");
    return "not_bound";
  }

  const messages = renderDigest(digest, { appUrl: options.appUrl, timezone: options.timezone });

  try {
    for (const message of messages) {
      await options.api.sendMessage(digest.telegramChatId, message);
    }
  } catch (thrown) {
    const error = toAppError(thrown);
    logger.warn("digest.delivery_failed", { ...ref, code: error.code, details: error.details });
    await markDigestFailed(db, ref, error.code);
    return "failed";
  }

  await markDigestDelivered(db, ref, options.now ?? new Date());
  logger.info("digest.delivered", { ...ref, cardCount: digest.cards.length });
  return "delivered";
}
