/**
 * Handling what Telegram sends: `/start <code>`, button presses, and replies.
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
import { getConfig, uuidv7 } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { schema, scoped } from "@mifluent/db";
import { findCardOwner, isCardAction, recordCardAction } from "@mifluent/domain";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { consumeBindingCode, deliverFirstDigestOnBind } from "./bind.js";
import { escapeHtml } from "./html.js";
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
      reply_to_message: z
        .object({
          text: z.string().optional(),
          /** Unix seconds, set by Telegram: when the question was asked. */
          date: z.number().optional(),
        })
        .optional(),
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

/** First 8 characters of a UUID (after the first hyphen group). */
/**
 * The tail, not the head: card ids are UUIDv7, whose first 48 bits are the
 * creation time, so every card of one digest shares its leading characters.
 * The last twelve hex digits are random.
 */
const CARD_ID_TAG_LENGTH = 12;

/** How long after the question a reply still counts as its answer. */
const DECISION_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function cardIdTag(cardId: string): string {
  return cardId.slice(-CARD_ID_TAG_LENGTH);
}

export function extractCardIdTag(text: string): string | null {
  const match = text.match(new RegExp(`#([a-f0-9]{${CARD_ID_TAG_LENGTH}})\\b`));
  return match?.[1] ?? null;
}

async function findCardByTag(
  db: Queryable,
  tenantId: string,
  profileId: string,
  tag: string,
): Promise<{ id: string; eventId: string } | null> {
  const rows = await db
    .select({
      id: schema.digestCards.id,
      eventId: schema.digestCards.eventId,
      createdAt: schema.digestCards.createdAt,
    })
    .from(schema.digestCards)
    .innerJoin(schema.digests, eq(schema.digests.id, schema.digestCards.digestId))
    .where(
      scoped(
        schema.digestCards,
        tenantId,
        eq(schema.digests.profileId, profileId),
        sql`${schema.digestCards.id}::text LIKE ${`%${tag}`}`,
      ),
    )
    .limit(2);

  const [row] = rows;
  if (!row) return null;
  return { id: row.id, eventId: row.eventId };
}

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

  // Check if this is a reply to our "What did you decide?" question
  if (message.reply_to_message?.text?.includes(strings.callback.influencedPrompt) ?? false) {
    await handleInfluencedReply(options, message, strings);
    return;
  }

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

  // Get profile's timezone
  const [profile] = await options.db
    .select({ delivery: schema.watchProfiles.delivery })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, bound.profileId))
    .limit(1);
  const timezone =
    profile?.delivery?.timezone ?? (bound.language === "ru" ? "Europe/Moscow" : "UTC");

  // Deliver first digest if available
  const config = getConfig();
  const digestDelivered = await deliverFirstDigestOnBind(
    options.db,
    options.api,
    bound.tenantId,
    bound.profileId,
    chatId,
    config.APP_URL,
    timezone,
  );

  if (!digestDelivered) {
    await options.api.sendMessage(chatId, {
      text: stringsFor(bound.language).binding.firstDigestCollecting,
    });
  }
}

async function handleInfluencedReply(
  options: HandleUpdateOptions,
  message: NonNullable<TelegramUpdate["message"]>,
  strings: ReturnType<typeof stringsFor>,
): Promise<void> {
  const chatId = String(message.chat.id);
  const replyText = message.text?.trim();

  if (!replyText) {
    await options.api.sendMessage(chatId, { text: strings.callback.influencedEmpty });
    return;
  }

  // The question ends with a visible tag (# + the card id's random tail). A
  // reply to a question older than a day is not trusted to still be about it.
  const repliedText = message.reply_to_message?.text ?? "";
  const askedAt = message.reply_to_message?.date;
  const tag = extractCardIdTag(repliedText);
  const isFresh = askedAt !== undefined && Date.now() - askedAt * 1000 <= DECISION_REPLY_WINDOW_MS;
  if (!tag || !isFresh) {
    await options.api.sendMessage(chatId, { text: strings.callback.influencedFailed });
    return;
  }

  // We need to find the card owner to get tenantId and profileId
  // First, find the profile that owns this chat
  const [profile] = await options.db
    .select({ id: schema.watchProfiles.id, tenantId: schema.watchProfiles.tenantId })
    .from(schema.watchProfiles)
    .where(sql`(${schema.watchProfiles.delivery}->>'telegramChatId') = ${chatId}`)
    .limit(1);

  if (!profile) {
    await options.api.sendMessage(chatId, { text: strings.callback.influencedFailed });
    return;
  }

  const card = await findCardByTag(options.db, profile.tenantId, profile.id, tag);
  if (!card) {
    await options.api.sendMessage(chatId, { text: strings.callback.influencedFailed });
    return;
  }

  const owner = await findCardOwner(options.db, card.id);
  if (owner === undefined || owner.telegramChatId !== chatId) {
    options.logger.warn("telegram.influenced_refused", { cardId: card.id });
    await options.api.sendMessage(chatId, { text: strings.callback.influencedFailed });
    return;
  }

  // Get target ID from event
  const [event] = await options.db
    .select({ targetId: schema.events.targetId })
    .from(schema.events)
    .where(scoped(schema.events, owner.tenantId, eq(schema.events.id, owner.eventId)))
    .limit(1);

  const targetId = event?.targetId ?? null;

  // Get target name for confirmation
  let targetName = "this target";
  if (targetId) {
    const [target] = await options.db
      .select({ name: schema.watchTargets.name })
      .from(schema.watchTargets)
      .where(scoped(schema.watchTargets, owner.tenantId, eq(schema.watchTargets.id, targetId)))
      .limit(1);
    targetName = target?.name ?? "this target";
  }

  // Record the decision
  const decisionText = replyText.slice(0, 1000);

  await options.db.insert(schema.decisions).values({
    id: uuidv7(),
    tenantId: owner.tenantId,
    profileId: owner.profileId,
    eventId: owner.eventId,
    targetId,
    text: decisionText,
    createdAt: new Date(),
  });

  // Also record the user action
  await recordCardAction(options.db, {
    tenantId: owner.tenantId,
    cardId: card.id,
    action: "influenced",
    surface: "telegram",
  });

  options.logger.info("telegram.influenced_recorded", {
    tenantId: owner.tenantId,
    cardId: card.id,
  });
  await options.api.sendMessage(chatId, {
    text: strings.callback.influencedRecorded(targetName),
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

  if (action === "influenced") {
    // Ask for the decision text
    await options.api.answerCallbackQuery(query.id, strings.callback.influencedPrompt);
    // chatId is guaranteed to be defined here because the check above would have returned early
    if (chatId === undefined) return;
    const questionText = escapeHtml(
      `${strings.callback.influencedPrompt}\n\n#${cardIdTag(cardId)}`,
    );
    await options.api.sendMessage(chatId, {
      text: questionText,
      parseMode: "HTML",
      forceReply: true,
    });
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
