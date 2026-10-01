/**
 * The radar's conversation with the owner: a draft with its buttons, and
 * what each button does. Only the owner's chat may press them; the channel
 * receives a post only from the "Publish" button.
 *
 * // TODO: security review — owner-only actions over Telegram
 */

import { getConfig, type Logger } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import {
  decideRadarPost,
  findRadarPost,
  listQueuedRadarPosts,
  type RadarPostDraft,
} from "@mifluent/domain";
import { composeTelegramPost, composeWeeklyPost, composeXPost } from "./radar-posts.js";
import type { TelegramApi } from "./telegram-api.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface RadarLinks {
  readonly siteUrl: string;
  readonly ctaUrl: (language: "en" | "ru") => string | null;
}

function radarLinks(): RadarLinks {
  const config = getConfig();
  const siteUrl = (config.RADAR_SITE_LINK ?? config.APP_URL).replace(/\/+$/, "");
  return {
    siteUrl,
    ctaUrl: (language) => (language === "ru" ? (config.RADAR_BOT_LINK ?? null) : siteUrl),
  };
}

function postInput(draft: RadarPostDraft, links: RadarLinks) {
  return {
    language: draft.language,
    company: draft.company,
    summary: draft.summary,
    quote: draft.quote,
    sourceUrl: draft.sourceUrl,
    pageUrl: `${links.siteUrl}/changes/${draft.slug}`,
    ctaUrl: links.ctaUrl(draft.language),
  };
}

export async function sendRadarDraft(
  api: TelegramApi,
  ownerChatId: string,
  draft: RadarPostDraft,
): Promise<void> {
  await api.sendMessage(ownerChatId, {
    text: composeTelegramPost(postInput(draft, radarLinks())),
    buttons: [
      { type: "callback", text: "📢 Publish", callbackData: `rp:${draft.postId}:pub` },
      { type: "callback", text: "𝕏 Copy for X", callbackData: `rp:${draft.postId}:x` },
      { type: "callback", text: "Skip", callbackData: `rp:${draft.postId}:skip` },
    ],
  });
}

/** Monday: one round-up draft per language of what waited over the daily limit. */
export async function sendWeeklyRadarDraft(
  db: Queryable,
  api: TelegramApi,
  ownerChatId: string,
  radarTenantId: string,
  language: "en" | "ru",
  weekEnd: Date,
): Promise<boolean> {
  const weekStart = new Date(weekEnd.getTime() - 7 * DAY_MS);
  const queued = await listQueuedRadarPosts(db, radarTenantId, language, weekStart, weekEnd);
  if (queued.length === 0) return false;
  const links = radarLinks();
  await api.sendMessage(ownerChatId, {
    text: composeWeeklyPost(
      language,
      queued.map((draft) => postInput(draft, links)),
      links.ctaUrl(language),
    ),
    buttons: [
      {
        type: "callback",
        text: "📢 Publish round-up",
        callbackData: `rw:${weekEnd.toISOString().slice(0, 10)}:${language}`,
      },
    ],
  });
  return true;
}

export function isRadarButton(data: string): boolean {
  return data.startsWith("rp:") || data.startsWith("rw:");
}

/** A press on a radar button. Returns the short answer shown to the owner. */
export async function handleRadarButton(input: {
  readonly db: Queryable;
  readonly api: TelegramApi;
  readonly logger: Logger;
  readonly chatId: string | undefined;
  readonly data: string;
}): Promise<string> {
  const config = getConfig();
  const radarTenantId = config.RADAR_TENANT_ID;
  if (
    radarTenantId === undefined ||
    input.chatId === undefined ||
    input.chatId !== config.OWNER_TELEGRAM_CHAT_ID
  ) {
    input.logger.warn("radar.button_refused", {});
    return "Not available.";
  }

  const [kind = "", key = "", action = ""] = input.data.split(":");
  if (kind === "rw") {
    return publishWeekly(input, radarTenantId, key, action === "ru" ? "ru" : "en");
  }

  const draft = await findRadarPost(input.db, radarTenantId, key);
  if (draft === undefined) return "Draft not found.";
  const links = radarLinks();

  if (action === "x") {
    await input.api.sendMessage(input.chatId, { text: composeXPost(postInput(draft, links)) });
    return "Sent below — copy it to X.";
  }
  if (action === "skip") {
    await decideRadarPost(input.db, draft.postId, "skipped", new Date());
    return "Skipped.";
  }
  if (action !== "pub") return "Not available.";

  const channel = config.RADAR_TELEGRAM_CHANNEL_ID;
  if (channel === undefined) return "Set RADAR_TELEGRAM_CHANNEL_ID first.";
  // Decided first, so two quick presses cannot post twice.
  if (!(await decideRadarPost(input.db, draft.postId, "published", new Date()))) {
    return "Already done.";
  }
  await input.api.sendMessage(channel, { text: composeTelegramPost(postInput(draft, links)) });
  input.logger.info("radar.published", { postId: draft.postId });
  return "Published.";
}

async function publishWeekly(
  input: { readonly db: Queryable; readonly api: TelegramApi },
  radarTenantId: string,
  weekEndDay: string,
  language: "en" | "ru",
): Promise<string> {
  const channel = getConfig().RADAR_TELEGRAM_CHANNEL_ID;
  if (channel === undefined) return "Set RADAR_TELEGRAM_CHANNEL_ID first.";
  const weekEnd = new Date(`${weekEndDay}T23:59:59Z`);
  if (Number.isNaN(weekEnd.getTime())) return "Not available.";

  const queued = await listQueuedRadarPosts(
    input.db,
    radarTenantId,
    language,
    new Date(weekEnd.getTime() - 8 * DAY_MS),
    weekEnd,
  );
  const now = new Date();
  const mine: RadarPostDraft[] = [];
  for (const draft of queued) {
    if (await decideRadarPost(input.db, draft.postId, "published", now)) mine.push(draft);
  }
  if (mine.length === 0) return "Already done.";
  const links = radarLinks();
  await input.api.sendMessage(channel, {
    text: composeWeeklyPost(
      language,
      mine.map((draft) => postInput(draft, links)),
      links.ctaUrl(language),
    ),
  });
  return "Published.";
}
