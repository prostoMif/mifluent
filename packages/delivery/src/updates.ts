/**
 * Handling what Telegram sends: `/start <code>`, button presses, and the one
 * line a reader writes after pressing "It changed a decision".
 *
 * The update is parsed with Zod; anything that does not fit is ignored rather
 * than guessed at. A button press names a card, and before anything is written
 * the card's profile must be bound to the very chat the press came from — a
 * card id is not a secret, and without this check anyone who saw one could
 * pause somebody else's targets.
 *
 * The same rule decides what a plain message means. A decision is filed only
 * against the question this bot asked, matched by the id of the message being
 * replied to and inside a day; anything else gets "press the button again"
 * rather than a guess, because a decision filed against the wrong card is
 * worse than no decision.
 *
 * The chat id is personal data and never goes to the log. Neither does the
 * decision text, at any level — see `docs/security.md` §8.
 *
 * // TODO: security review — authorisation of button presses
 */

import type { Logger } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import {
  findCardOwner,
  INFLUENCED_ACTION,
  isTelegramCardAction,
  recordCardAction,
  recordDecision,
} from "@mifluent/domain";
import { z } from "zod";
import { consumeBindingCode } from "./bind.js";
import {
  type ChatProfile,
  clearPendingDecision,
  isWithinReplyWindow,
  listChatProfiles,
  type PendingDecision,
  setPendingDecision,
} from "./pending-decision.js";
import { type Strings, stringsFor } from "./strings.js";
import type { TelegramApi } from "./telegram-api.js";

const chatSchema = z.object({ id: z.number() });

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: chatSchema,
      text: z.string().max(4_096).optional(),
      from: z.object({ language_code: z.string().optional() }).optional(),
      /** Present when the reader used the reply box this bot opened. */
      reply_to_message: z.object({ message_id: z.number() }).optional(),
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
  readonly now?: Date | undefined;
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

  if (code !== undefined) {
    await bind(options, chatId, code, strings);
    return;
  }

  if (await handleDecisionAnswer(options, chatId, message, strings)) return;

  await options.api.sendMessage(chatId, { text: strings.binding.help });
}

async function bind(
  options: HandleUpdateOptions,
  chatId: string,
  code: string,
  strings: Strings,
): Promise<void> {
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

/**
 * An answer to the decision question, if that is what this message is.
 *
 * Returns false when no profile delivering to this chat is waiting for one, so
 * the caller can fall back to the help text. It never guesses: a reply to
 * something else, an answer with no reply at all, or one that arrives after
 * the window asks the reader to press the button again.
 */
async function handleDecisionAnswer(
  options: HandleUpdateOptions,
  chatId: string,
  message: NonNullable<TelegramUpdate["message"]>,
  strings: Strings,
): Promise<boolean> {
  const waiting = (await listChatProfiles(options.db, chatId)).filter(
    (profile): profile is ChatProfile & { pending: PendingDecision } =>
      profile.pending !== undefined,
  );
  if (waiting.length === 0) return false;

  const now = options.now ?? new Date();
  const replyTo = message.reply_to_message?.message_id;
  const answered = waiting.find(
    (profile) =>
      profile.pending.messageId === replyTo &&
      isWithinReplyWindow(profile.pending, now) &&
      (message.text ?? "").trim() !== "",
  );

  if (answered === undefined) {
    // Drop questions nobody can answer any more rather than leave them open.
    for (const profile of waiting) {
      if (!isWithinReplyWindow(profile.pending, now)) {
        await clearPendingDecision(options.db, profile.tenantId, profile.profileId);
      }
    }
    await options.api.sendMessage(chatId, { text: strings.decision.pressAgain });
    return true;
  }

  await clearPendingDecision(options.db, answered.tenantId, answered.profileId);

  const decision = await recordDecision(options.db, {
    tenantId: answered.tenantId,
    cardId: answered.pending.cardId,
    // The only place this text is passed anywhere. It is never logged.
    text: message.text ?? "",
  });

  options.logger.info("decision.recorded", {
    tenantId: answered.tenantId,
    profileId: answered.profileId,
    decisionId: decision.id,
  });
  await options.api.sendMessage(chatId, { text: strings.decision.recorded(decision.targetName) });
  return true;
}

async function handleButton(
  options: HandleUpdateOptions,
  query: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const strings = stringsFor(query.from?.language_code?.startsWith("ru") === true ? "ru" : "en");
  const chatId = query.message === undefined ? undefined : String(query.message.chat.id);
  const [action = "", cardId = ""] = (query.data ?? "").split(":");

  const owner =
    chatId === undefined || !isTelegramCardAction(action)
      ? undefined
      : await findCardOwner(options.db, cardId);

  // Same answer for "no such card" and "not your card": the second must not
  // confirm that the card exists.
  if (owner === undefined || owner.telegramChatId !== chatId || !isTelegramCardAction(action)) {
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

  if (action === INFLUENCED_ACTION) {
    await askForDecision(options, { chatId, cardId, owner, strings });
  }
}

async function askForDecision(
  options: HandleUpdateOptions,
  context: {
    readonly chatId: string;
    readonly cardId: string;
    readonly owner: { readonly tenantId: string; readonly profileId: string };
    readonly strings: Strings;
  },
): Promise<void> {
  const sent = await options.api.sendMessage(context.chatId, {
    text: context.strings.decision.question,
    forceReply: true,
  });

  await setPendingDecision(options.db, context.owner.tenantId, context.owner.profileId, {
    cardId: context.cardId,
    messageId: sent.messageId,
    askedAt: options.now ?? new Date(),
  });
}
