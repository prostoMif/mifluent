/**
 * Signing up without leaving Telegram: `/start` → send your site → the bot
 * reads it → one message with what it found and a "Go" button → the first
 * digest arrives in this chat. The site's start page uses the same last step
 * when the visitor chose Telegram (`/start w_<pending>`).
 *
 * // TODO: security review — Telegram identity
 */

import { getConfig, type Logger, toAppError } from "@mifluent/core";
import type { Database } from "@mifluent/db";
import {
  claimPendingForTelegram,
  completeTelegramSignup,
  findRunningTelegramSignup,
  getPendingOnboarding,
  isRegistrationOpenFor,
  pendingIdToStartParam,
  profileInputFromPending,
  QUEUES,
  type QueueName,
  startParamToPendingId,
  startTelegramSignup,
} from "@mifluent/domain";
import type { TelegramApi } from "./telegram-api.js";

/** Queue a job from wherever the update is handled (the web app or the worker). */
export type Enqueue = (
  queue: QueueName,
  data: { readonly tenantId: string; readonly [field: string]: unknown },
) => Promise<unknown>;

export interface SignupContext {
  readonly db: Database;
  readonly api: TelegramApi;
  readonly logger: Logger;
  readonly enqueue: Enqueue | undefined;
  readonly chatId: string;
  readonly telegramUserId: string;
  readonly name: string;
  readonly language: "en" | "ru";
}

const MAX_LISTED_TARGETS = 12;

const TEXT = {
  en: {
    askSite: [
      "Hi! Every morning I send a short brief: what your competitors, platforms and the rules of your market changed — with a quote from the source.",
      "",
      "It looks like this:",
      "💰 Northwind CRM · yesterday",
      "Team plan up from $29 to $39 per seat.",
      "«Team is now $39 per seat per month.» — source",
      "Why it matters: you are now $10 cheaper.",
      "",
      "Send me your website address — or one sentence about your business — and I'll find who to watch.",
    ].join("\n"),
    closed: "Sign-up is closed on this instance for now.",
    reading: "Reading your site… this takes a minute or two.",
    stillReading: "Still reading your site — I'll write as soon as I'm done.",
    failed: (reason: string) =>
      `Could not read that: ${reason}\nSend another address or a sentence about the business.`,
    found: (name: string) => `Here is what I found about ${name}.`,
    watch: "I'll watch:",
    more: (count: number) => `…and ${count} more`,
    none: "No competitors found yet — you can add them later in the app.",
    go: "✅ Looks right, go",
    started: "Done! Collecting your first brief — it arrives here in a few minutes.",
    expired: "That sign-up has expired. Send /start to begin again.",
    notYours: "This sign-up belongs to someone else.",
  },
  ru: {
    askSite: [
      "Привет! Каждое утро присылаю короткую сводку: что поменяли конкуренты, площадки и правила твоего рынка — с цитатой из источника.",
      "",
      "Выглядит так:",
      "💰 Конкурент · вчера",
      "Поднял тариф «Команда» с 2 990 до 3 490 ₽.",
      "«Тариф Команда — 3 490 ₽ в месяц.» — источник",
      "Почему касается: ты теперь дешевле на 500 ₽.",
      "",
      "Пришли адрес своего сайта — или одно предложение о бизнесе, — и я найду, за кем следить.",
    ].join("\n"),
    closed: "Регистрация здесь пока закрыта.",
    reading: "Читаю сайт… это займёт минуту-две.",
    stillReading: "Ещё читаю сайт — напишу, как закончу.",
    failed: (reason: string) =>
      `Не получилось: ${reason}\nПришли другой адрес или опиши бизнес одним предложением.`,
    found: (name: string) => `Вот что я нашёл про «${name}».`,
    watch: "Буду следить:",
    more: (count: number) => `…и ещё ${count}`,
    none: "Конкурентов пока не нашёл — их можно добавить позже в приложении.",
    go: "✅ Всё верно, поехали",
    started: "Готово! Собираю первую сводку — придёт сюда через несколько минут.",
    expired: "Эта регистрация устарела. Отправь /start, чтобы начать заново.",
    notYours: "Эта регистрация принадлежит другому человеку.",
  },
} as const;

/**
 * The offer and the consent to process personal data must be in front of a
 * person before they send anything (152-ФЗ, ст. 9; ст. 437–438 ГК РФ):
 * sending a site counts as accepting, so the links come with the first ask.
 */
function consentLine(language: "en" | "ru"): string {
  const base = getConfig().APP_URL.replace(/\/+$/, "");
  return language === "ru"
    ? `Отправляя адрес, ты принимаешь оферту (${base}/terms) и соглашаешься на обработку данных по политике (${base}/privacy).`
    : `By sending an address you accept the terms (${base}/terms) and the privacy policy (${base}/privacy).`;
}

export async function askForSite(context: SignupContext): Promise<void> {
  const text = TEXT[context.language];
  const isOpen = await isRegistrationOpenFor(context.db);
  await context.api.sendMessage(context.chatId, {
    text: isOpen ? `${text.askSite}\n\n${consentLine(context.language)}` : text.closed,
  });
}

/** A message from someone with no account: their site, or a sentence about the business. */
export async function handleSignupInput(context: SignupContext, input: string): Promise<void> {
  const text = TEXT[context.language];
  if (!(await isRegistrationOpenFor(context.db))) {
    await context.api.sendMessage(context.chatId, { text: text.closed });
    return;
  }
  if ((await findRunningTelegramSignup(context.db, context.telegramUserId)) !== undefined) {
    await context.api.sendMessage(context.chatId, { text: text.stillReading });
    return;
  }

  try {
    const started = await startTelegramSignup(context.db, {
      chatId: context.chatId,
      telegramUserId: context.telegramUserId,
      text: input,
      language: context.language,
    });
    if (started.jobData === undefined) {
      // A recent reading of the same site was reused: the result is here.
      await sendSignupListing(context.db, context.api, started.pendingId);
      return;
    }
    await context.enqueue?.(QUEUES.discoveryRun, { ...started.jobData.data });
    await context.api.sendMessage(context.chatId, { text: text.reading });
  } catch (thrown) {
    await context.api.sendMessage(context.chatId, {
      text: text.failed(toAppError(thrown).message),
    });
  }
}

/** `/start w_<pending>` from the site's start page: claim it, then confirm straight away. */
export async function handleSiteHandoff(context: SignupContext, param: string): Promise<boolean> {
  const pendingId = startParamToPendingId(param);
  if (pendingId === undefined) return false;

  const claimed = await claimPendingForTelegram(context.db, {
    pendingId,
    chatId: context.chatId,
    telegramUserId: context.telegramUserId,
  });
  if (!claimed) {
    await context.api.sendMessage(context.chatId, { text: TEXT[context.language].expired });
    return true;
  }
  await confirmSignup(context, pendingId);
  return true;
}

/** The "Go" button under the listing: `su:<32 hex>`. */
export function isSignupButton(data: string): boolean {
  return data.startsWith("su:");
}

export async function handleSignupButton(context: SignupContext, data: string): Promise<string> {
  const pendingId = startParamToPendingId(`w_${data.slice(3)}`);
  if (pendingId === undefined) return TEXT[context.language].expired;
  return confirmSignup(context, pendingId);
}

async function confirmSignup(context: SignupContext, pendingId: string): Promise<string> {
  const text = TEXT[context.language];
  const completed = await completeTelegramSignup(context.db, {
    pendingId,
    chatId: context.chatId,
    telegramUserId: context.telegramUserId,
    name: context.name,
    defaultTimezone: getConfig().DEFAULT_TIMEZONE,
  });
  if (completed === undefined) {
    await context.api.sendMessage(context.chatId, { text: text.expired });
    return text.expired;
  }
  await context.enqueue?.(QUEUES.profileFirstRun, { ...completed });
  context.logger.info("telegram.signup_completed", { ...completed });
  await context.api.sendMessage(context.chatId, { text: text.started });
  return text.started;
}

/**
 * Discovery finished for a sign-up that runs in Telegram: one message with
 * the business, the targets, and the "Go" button. Called by the worker.
 */
export async function sendSignupListing(
  db: Database,
  api: TelegramApi,
  pendingId: string,
): Promise<void> {
  const pending = await getPendingOnboarding(db, pendingId);
  if (pending?.telegramChatId == null) return;
  const text = TEXT[pending.language === "ru" ? "ru" : "en"];
  const profile = profileInputFromPending(pending);
  if (profile === undefined) {
    await api.sendMessage(pending.telegramChatId, { text: text.failed("—") });
    return;
  }

  const names = profile.targets.filter((target) => target.kind !== "self").map((t) => t.name);
  const listed = names.slice(0, MAX_LISTED_TARGETS).map((name) => `• ${name}`);
  if (names.length > MAX_LISTED_TARGETS) listed.push(text.more(names.length - MAX_LISTED_TARGETS));
  const body = [
    text.found(profile.name),
    profile.businessDescription ?? "",
    names.length === 0 ? text.none : `${text.watch}\n${listed.join("\n")}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

  await api.sendMessage(pending.telegramChatId, {
    text: body.slice(0, 4_000),
    buttons: [
      {
        type: "callback",
        text: text.go,
        callbackData: `su:${pendingIdToStartParam(pendingId).slice(2)}`,
      },
    ],
  });
}

/** Discovery failed for a Telegram sign-up: say so and ask for another site. Called by the worker. */
export async function sendSignupFailure(
  api: TelegramApi,
  chatId: string,
  language: string,
  reason: string,
): Promise<void> {
  await api.sendMessage(chatId, { text: TEXT[language === "ru" ? "ru" : "en"].failed(reason) });
}
