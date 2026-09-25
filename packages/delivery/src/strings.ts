/**
 * The sentences a digest is made of, in the two languages the product writes.
 *
 * Everything the model wrote arrives already in the profile's language; these
 * are the frame around it.
 */

export type Language = "en" | "ru";

export interface Strings {
  readonly digestTitle: (profile: string, period: string) => string;
  readonly urgentTitle: (profile: string) => string;
  readonly age: (days: number) => string;
  readonly whyItMatters: string;
  readonly modelInterpretation: string;
  readonly source: string;
  readonly groupHeadline: (target: string, count: number) => string;
  readonly more: (count: number) => string;
  readonly emptyDigest: (period: string, sources: number, items: number) => string;
  readonly closest: string;
  readonly rejectedBecause: string;
  readonly rejectionReason: (code: string) => string;
  readonly notices: {
    readonly baselineRecorded: string;
    readonly costCapReached: string;
    readonly targetQuiet: (target: string) => string;
  };
  readonly buttons: {
    readonly notFollowing: string;
    readonly notImportant: string;
    readonly save: string;
    readonly influenced: string;
  };
  readonly callback: {
    readonly recorded: string;
    readonly notFound: string;
  };
  readonly decision: {
    readonly question: string;
    readonly recorded: (target: string | null) => string;
    readonly pressAgain: string;
  };
  readonly binding: {
    readonly bound: (profile: string) => string;
    readonly invalidCode: string;
    readonly help: string;
  };
}

const en: Strings = {
  digestTitle: (profile, period) => `${profile} — ${period}`,
  urgentTitle: (profile) => `Urgent — ${profile}`,
  age: (days) => (days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`),
  whyItMatters: "Why it matters:",
  modelInterpretation: "Model's interpretation ⚠",
  source: "source",
  groupHeadline: (target, count) => `${target}: ${count} changes`,
  more: (count) => `and ${count} more`,
  emptyDigest: (period, sources, items) =>
    `Nothing that concerns you for ${period}. Checked ${sources} sources, ${items} items.`,
  closest: "Closest:",
  rejectedBecause: "rejected:",
  rejectionReason: (code) =>
    ({
      below_cosine: "too far from what you watch",
      model_rejected: "judged not relevant",
      no_verified_quote: "no quote could be verified",
    })[code] ?? code,
  notices: {
    baselineRecorded:
      "Prices, changelogs and job boards are now recorded; changes will show up from the next check.",
    costCapReached:
      "Processing is paused until tomorrow — this instance reached its daily budget. You can add your own model key in settings.",
    targetQuiet: (target) => `${target} has been quieter than usual.`,
  },
  buttons: {
    notFollowing: "Not following this",
    notImportant: "Not important",
    save: "Save",
    influenced: "It changed a decision",
  },
  callback: { recorded: "Noted", notFound: "That card is no longer available" },
  decision: {
    question: "What did you decide? Answer in one line.",
    recorded: (target) =>
      target === null
        ? "Written down. It will show up in your history."
        : `Written down. It will show up in the history for ${target}.`,
    pressAgain:
      "I am not sure which card that answers. Press “It changed a decision” under the card again.",
  },
  binding: {
    bound: (profile) => `Done. Digests for “${profile}” will arrive here.`,
    invalidCode: "That code is not valid or has expired. Get a new one in Mifluent.",
    help: "Send /start followed by the code shown in Mifluent to receive digests here.",
  },
};

const ru: Strings = {
  digestTitle: (profile, period) => `${profile} — ${period}`,
  urgentTitle: (profile) => `Срочно — ${profile}`,
  age: (days) => (days === 0 ? "сегодня" : days === 1 ? "вчера" : `${days} дн. назад`),
  whyItMatters: "Почему касается:",
  modelInterpretation: "Интерпретация модели ⚠",
  source: "источник",
  groupHeadline: (target, count) => `${target}: ${count} изменений`,
  more: (count) => `и ещё ${count}`,
  emptyDigest: (period, sources, items) =>
    `Ничего, что тебя касается, за ${period}. Проверено ${sources} источников, ${items} материалов.`,
  closest: "Ближе всего:",
  rejectedBecause: "отклонено:",
  rejectionReason: (code) =>
    ({
      below_cosine: "далеко от того, за чем ты следишь",
      model_rejected: "модель сочла нерелевантным",
      no_verified_quote: "не нашлось проверяемой цитаты",
    })[code] ?? code,
  notices: {
    baselineRecorded:
      "Цены, changelog и вакансии зафиксированы, изменения пойдут со следующего опроса.",
    costCapReached:
      "Обработка приостановлена до завтра — лимит бюджета инстанса. Можно вставить свой ключ в настройках.",
    targetQuiet: (target) => `У ${target} тише обычного.`,
  },
  buttons: {
    notFollowing: "Не слежу за этим",
    notImportant: "Не важно",
    save: "Сохранить",
    influenced: "Повлияло",
  },
  callback: { recorded: "Принято", notFound: "Эта карточка больше недоступна" },
  decision: {
    question: "Что ты решил? Ответь одной строкой.",
    recorded: (target) =>
      target === null ? "Записал. Покажу в истории." : `Записал. Покажу в истории по ${target}.`,
    pressAgain: "Не понял, к какой карточке это ответ. Нажми «Повлияло» под карточкой ещё раз.",
  },
  binding: {
    bound: (profile) => `Готово. Сводки по «${profile}» будут приходить сюда.`,
    invalidCode: "Код неверный или истёк. Получите новый в Mifluent.",
    help: "Отправьте /start и код из Mifluent, чтобы получать сводки здесь.",
  },
};

export function stringsFor(language: Language): Strings {
  return language === "ru" ? ru : en;
}

/** "21–28 Sep 2026", in the reader's language and zone. */
export function formatPeriod(start: Date, end: Date, language: Language, timezone: string): string {
  const format = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  });
  const from = format.format(start);
  const to = format.format(end);
  return from === to ? to : `${from} — ${to}`;
}
