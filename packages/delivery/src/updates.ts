/**
 * Handling what Telegram sends: `/start <code>` and button presses.
 *
 * The update is parsed with Zod; anything that does not fit is ignored rather
 * than guessed at. A button press names a card, and before anything is written
 * the card's profile must be bound to the very chat the press came from — a
 * card id is not a secret, and without this check anyone who saw one could
 * pause somebody else's targets.
 *
 * The chat id is personal data and never goes to the log.
 *
 * // TODO: security review — authorisation of button presses
 */

import type { Logger } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { findCardOwner, isCardAction, recordCardAction } from "@mifluent/domain";
import { z } from "zod";
import { consumeBindingCode } from "./bind.js";
import { stringsFor } from "./strings.js";
import type { TelegramApi } from "./telegram-api.js";

const chatSchema = z.object({ id: z.number() });

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: chatSchema,
      text: z.string().max(4_096).optional(),
      from: z.object({ language_code: z.string().optional() }).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().max(64).optional(),
      message: z.object({ chat: chatSchema }).optional(),
      from: z.object({ language_code: z.string().optional() }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface HandleUpdateOptions {
  readonly db: Queryable;
  readonly api: TelegramApi;
  readonly logger: Logger;
  readonly update: unknown;
}

const START_COMMAND = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]{4,32}))?\s*$/;

export async function handleTelegramUpdate(options: HandleUpdateOptions): Promise<void> {
  const parsed = telegramUpdateSchema.safeParse(options.update);
  if (!parsed.success) {
    options.logger.warn("telegram.update_ignored", { reason: "unrecognised shape" });
    return;
  }

  const update = parsed.data;
  if (update.callback_query !== undefined) {
    await handleButton(options, update.callback_query);
    return;
  }
  if (update.message !== undefined) {
    await handleMessage(options, update.message);
  }
}

async function handleMessage(
  options: HandleUpdateOptions,
  message: NonNullable<TelegramUpdate["message"]>,
): Promise<void> {
  const chatId = String(message.chat.id);
  const strings = stringsFor(message.from?.language_code?.startsWith("ru") === true ? "ru" : "en");
  const match = START_COMMAND.exec(message.text?.trim() ?? "");
  const code = match?.[1];

  if (code === undefined) {
    await options.api.sendMessage(chatId, { text: strings.binding.help });
    return;
  }

  const bound = await consumeBindingCode(options.db, code, chatId);
  if (bound === undefined) {
    options.logger.info("telegram.binding_refused", {});
    await options.api.sendMessage(chatId, { text: strings.binding.invalidCode });
    return;
  }

  options.logger.info("telegram.bound", { tenantId: bound.tenantId, profileId: bound.profileId });
  await options.api.sendMessage(chatId, {
    text: stringsFor(bound.language).binding.bound(bound.profileName),
  });
}

async function handleButton(
  options: HandleUpdateOptions,
  query: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const strings = stringsFor(query.from?.language_code?.startsWith("ru") === true ? "ru" : "en");
  const chatId = query.message === undefined ? undefined : String(query.message.chat.id);
  const [action = "", cardId = ""] = (query.data ?? "").split(":");

  const owner =
    chatId === undefined || !isCardAction(action)
      ? undefined
      : await findCardOwner(options.db, cardId);

  // Same answer for "no such card" and "not your card": the second must not
  // confirm that the card exists.
  if (owner === undefined || owner.telegramChatId !== chatId || !isCardAction(action)) {
    options.logger.warn("telegram.button_refused", { action });
    await options.api.answerCallbackQuery(query.id, strings.callback.notFound);
    return;
  }

  await recordCardAction(options.db, {
    tenantId: owner.tenantId,
    cardId,
    action,
    surface: "telegram",
  });
  options.logger.info("telegram.button_recorded", { tenantId: owner.tenantId, action });
  await options.api.answerCallbackQuery(query.id, strings.callback.recorded);
}
