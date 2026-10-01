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
import type { Database, Queryable } from "@mifluent/db";
import { schema, scoped } from "@mifluent/db";
import {
  assertCanWatchPage,
  createSource,
  findCardOwner,
  hasTelegramAccount,
  isCardAction,
  linkOwnerTelegram,
  readWatchedPagesAllowance,
  recordCardAction,
  recordPageBaseline,
} from "@mifluent/domain";
import { htmlToText, safeFetch } from "@mifluent/sources";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { consumeBindingCode, deliverFirstDigestOnBind } from "./bind.js";
import {
  askForSite,
  type Enqueue,
  handleSignupButton,
  handleSignupInput,
  handleSiteHandoff,
  isSignupButton,
  type SignupContext,
} from "./bot-signup.js";
import { escapeHtml } from "./html.js";
import { handleRadarButton, isRadarButton } from "./radar-telegram.js";
import { stringsFor } from "./strings.js";
import type { TelegramApi } from "./telegram-api.js";

const chatSchema = z.object({ id: z.number(), type: z.string().optional() });

const fromSchema = z.object({
  id: z.number().optional(),
  first_name: z.string().optional(),
  language_code: z.string().optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: chatSchema,
      text: z.string().max(4_096).optional(),
      from: fromSchema.optional(),
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
      from: fromSchema.optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export interface HandleUpdateOptions {
  readonly db: Queryable;
  readonly api: TelegramApi;
  readonly logger: Logger;
  readonly update: unknown;
  /** Queues sign-up jobs (discovery, first run); without it the bot cannot sign anyone up. */
  readonly enqueue?: Enqueue | undefined;
}

const START_COMMAND = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9]{4,32}))?\s*$/;
/** `/start ref_ABC` or `/start promo_ABC`: a link from a friend or a post. */
const START_LINK_COMMAND = /^\/start(?:@\w+)?\s+(ref|promo)_([A-Za-z0-9_-]{3,32})\s*$/;
const WATCH_COMMAND = /^\/watch(?:@\w+)?(?:\s+(\S+))?\s*$/;

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
  const text = message.text?.trim() ?? "";

  // Check if this is a reply to our "What did you decide?" question
  if (message.reply_to_message?.text?.includes(strings.callback.influencedPrompt) ?? false) {
    await handleInfluencedReply(options, message, strings);
    return;
  }

  // Check for /watch command
  const watchMatch = WATCH_COMMAND.exec(text);
  if (watchMatch !== null) {
    await handleWatchCommand(options, chatId, strings, watchMatch[1]);
    return;
  }

  if (await handleStartLink(options, chatId, strings, text)) return;

  const signup = signupContext(options, message);
  const code = START_COMMAND.exec(text)?.[1];
  if (code === undefined) {
    if (!(await handleSignupMessage(options, signup, text))) {
      await options.api.sendMessage(chatId, { text: strings.binding.help });
    }
    return;
  }

  const bound = await consumeBindingCode(options.db, code, chatId);
  if (bound === undefined) {
    options.logger.info("telegram.binding_refused", {});
    await options.api.sendMessage(chatId, { text: strings.binding.invalidCode });
    return;
  }

  if (signup !== undefined) {
    await linkOwnerTelegram(options.db, bound.tenantId, signup.telegramUserId);
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

  const special = await handleSpecialButton(options, query, chatId);
  if (special !== undefined) {
    await options.api.answerCallbackQuery(query.id, special.slice(0, 190));
    return;
  }

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

async function handleWatchCommand(
  options: HandleUpdateOptions,
  chatId: string,
  strings: ReturnType<typeof stringsFor>,
  url: string | undefined,
): Promise<void> {
  if (!url) {
    await options.api.sendMessage(chatId, { text: strings.watch.help });
    return;
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      await options.api.sendMessage(chatId, { text: strings.watch.help });
      return;
    }
  } catch {
    await options.api.sendMessage(chatId, { text: strings.watch.help });
    return;
  }

  // Find the profile bound to this chat
  const [profile] = await options.db
    .select({ id: schema.watchProfiles.id, tenantId: schema.watchProfiles.tenantId })
    .from(schema.watchProfiles)
    .where(sql`(${schema.watchProfiles.delivery}->>'telegramChatId') = ${chatId}`)
    .limit(1);

  if (!profile) {
    await options.api.sendMessage(chatId, { text: strings.binding.invalidCode });
    return;
  }

  // Check watched pages limit
  try {
    await assertCanWatchPage(options.db, profile.tenantId);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "plan_limit_reached") {
      const allowance = await readWatchedPagesAllowance(options.db, profile.tenantId);
      await options.api.sendMessage(chatId, { text: strings.watch.limitReached(allowance.limit) });
      return;
    }
    throw error;
  }

  // Fetch the page to verify it's readable
  const USER_AGENT = "Mifluent/1.0";
  try {
    const result = await safeFetch({
      url,
      userAgent: USER_AGENT,
      maxBytes: 5 * 1024 * 1024, // 5 MB
    });

    if (result.isUnchanged) {
      // 304 - shouldn't happen on first fetch
      await options.api.sendMessage(chatId, { text: strings.watch.cannotRead });
      return;
    }

    const html = result.body.toString("utf-8");
    const extractedText = htmlToText(html).trim();

    if (extractedText.length < 200) {
      // Page is too short (likely login page, error, or JS-rendered)
      await options.api.sendMessage(chatId, { text: strings.watch.cannotRead });
      return;
    }

    // Create the diff source
    const sourceId = await createSource({
      db: options.db,
      tenantId: profile.tenantId,
      profileId: profile.id,
      input: {
        kind: "diff",
        label: `Page watch: ${parsedUrl.hostname}`,
        locator: url,
        pollIntervalMinutes: 1440, // Daily default, will be adjusted by plan
      },
      targetId: null, // No target for arbitrary page watches
    });

    // Record baseline
    await recordPageBaseline(options.db, {
      tenantId: profile.tenantId,
      sourceId,
      contentHash: "",
      extractedText,
      fetchedAt: new Date(),
    });

    await options.api.sendMessage(chatId, { text: strings.watch.baselineRecorded });
  } catch (error) {
    options.logger.error("telegram.watch_failed", { url, error: String(error) });
    await options.api.sendMessage(chatId, { text: strings.watch.cannotRead });
  }
}

/**
 * `/start ref_…` or `/start promo_…`. The bonus is remembered by the site's
 * sign-up (a cookie), so the code is carried there; a sign-up made inside
 * the bot does not pick it up yet.
 */
async function handleStartLink(
  options: HandleUpdateOptions,
  chatId: string,
  strings: ReturnType<typeof stringsFor>,
  text: string,
): Promise<boolean> {
  const linkMatch = START_LINK_COMMAND.exec(text);
  if (linkMatch === null) return false;
  const kind = linkMatch[1] === "ref" ? "ref" : "promo";
  const url = `${getConfig().APP_URL}/r/${kind}/${encodeURIComponent(linkMatch[2] ?? "")}`;
  await options.api.sendMessage(chatId, { text: strings.startFromLink(kind, url) });
  return true;
}

/** Sign-up and radar buttons; undefined for a card button. */
async function handleSpecialButton(
  options: HandleUpdateOptions,
  query: NonNullable<TelegramUpdate["callback_query"]>,
  chatId: string | undefined,
): Promise<string | undefined> {
  const data = query.data ?? "";
  if (isSignupButton(data)) {
    const signup =
      chatId === undefined
        ? undefined
        : signupContext(options, {
            chat: { id: Number(chatId), type: "private" },
            from: query.from,
          });
    return signup === undefined ? "Not available." : handleSignupButton(signup, data);
  }
  if (isRadarButton(data)) {
    return handleRadarButton({
      db: options.db,
      api: options.api,
      logger: options.logger,
      chatId,
      data,
    });
  }
  return undefined;
}

/**
 * A message that is not a binding code: the site's hand-off (`/start w_…`),
 * or — from someone without an account — the sign-up dialogue. False when
 * it is neither, so the caller shows the usual help.
 */
async function handleSignupMessage(
  options: HandleUpdateOptions,
  signup: SignupContext | undefined,
  text: string,
): Promise<boolean> {
  if (signup === undefined) return false;
  const startParam = /^\/start(?:@\w+)?\s+(w_[0-9a-f]{32})\s*$/.exec(text)?.[1];
  if (startParam !== undefined) return handleSiteHandoff(signup, startParam);
  if (await hasTelegramAccount(options.db, signup.telegramUserId)) return false;
  if (text.startsWith("/")) await askForSite(signup);
  else await handleSignupInput(signup, text);
  return true;
}

/**
 * Who is signing up, when it is a person in a private chat. Group chats are
 * only ever bound to an existing profile by code.
 */
function signupContext(
  options: HandleUpdateOptions,
  message: {
    readonly chat: { readonly id: number; readonly type?: string | undefined };
    readonly from?: z.infer<typeof fromSchema> | undefined;
  },
): SignupContext | undefined {
  const from = message.from;
  if (from?.id === undefined || message.chat.type !== "private") return undefined;
  return {
    db: options.db as Database,
    api: options.api,
    logger: options.logger,
    enqueue: options.enqueue,
    chatId: String(message.chat.id),
    telegramUserId: String(from.id),
    name: from.first_name ?? "",
    language: from.language_code?.startsWith("ru") === true ? "ru" : "en",
  };
}
