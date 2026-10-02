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
  readonly selfGroupHeadline: (count: number) => string;
  /** Heading of the section for pack material: laws, platform rules, market news. */
  readonly marketSection: string;
  /** Sent three days before and on the last day of the free trial. */
  readonly trialEnding: (daysLeft: number, pricingUrl: string) => string;
  /** One message, a month after paid time ran out. */
  readonly winback: (code: string, pricingUrl: string) => string;
  /** `/start ref_…` or `/start promo_…`: where to sign up with the bonus kept. */
  readonly startFromLink: (kind: "ref" | "promo", url: string) => string;
  readonly more: (count: number) => string;
  /** One line under the title: "3 changes at 2 competitors · 1 about your market". */
  readonly summary: (changes: number, targets: number, market: number) => string;
  /** Russian plurals and English -s, in one place. */
  readonly kindLabel: (kind: string) => string;
  readonly help: string;
  readonly emptyDigest: (period: string, sources: number, items: number) => string;
  readonly emptyDigestFirstWeek: (sources: number, items: number, closestTitle: string) => string;
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
    readonly openMiniApp: string;
    readonly openTarget: string;
    readonly fullReport: string;
  };
  readonly callback: {
    readonly recorded: string;
    readonly notFound: string;
    readonly influencedPrompt: string;
    readonly influencedEmpty: string;
    readonly influencedFailed: string;
    readonly influencedRecorded: (target: string) => string;
  };
  readonly binding: {
    readonly bound: (profile: string) => string;
    readonly invalidCode: string;
    readonly help: string;
    readonly firstDigestCollecting: string;
  };
  readonly onboarding: {
    readonly closedRegistration: string;
    readonly awaitingInput: string;
    readonly discoveryProgress: (progressText: string) => string;
    readonly businessFacts: string;
    readonly noDescription: string;
    readonly targets: string;
    readonly targetLimit: (max: number) => string;
    readonly listingActions: string;
    readonly go: string;
    readonly addCompetitor: string;
    readonly chooseTimezone: string;
    readonly otherTimezone: string;
    readonly progressReadingSite: string;
    readonly progressFindingCompetitors: string;
    readonly progressCheckingBlogs: string;
    readonly progressCheckingPrices: string;
    readonly progressAlmostDone: string;
  };
  readonly watch: {
    readonly help: string;
    readonly baselineRecorded: string;
    readonly cannotRead: string;
    readonly limitReached: (limit: number) => string;
  };
  readonly monthly: {
    readonly stats: (parts: {
      readonly active: number;
      readonly quiet: number;
      readonly prices: number;
      readonly hiring: number;
      readonly decisions: number;
      readonly drifted: number;
    }) => string[];
    readonly title: (profile: string, month: string) => string;
    readonly shortTitle: (profile: string, month: string) => string;
    readonly proOnly: string;
    readonly topEvents: string;
    readonly perTarget: string;
    readonly priceChanges: string;
    readonly hiring: string;
    readonly decisions: string;
    readonly drift: string;
    readonly noEvents: string;
    readonly quiet: string;
    readonly eventsCount: (count: number) => string;
    readonly priceChangeRow: (
      target: string,
      kind: string,
      was: string | null,
      became: string,
    ) => string;
    readonly hiringRow: (target: string, open: number, newCount: number) => string;
    readonly decisionCount: (count: number) => string;
    readonly driftedTarget: (target: string, days: number) => string;
    readonly sourcesChecked: (sources: number, items: number) => string;
    readonly introLabel: string;
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
  selfGroupHeadline: (count) => `About you: ${count} mention${count === 1 ? "" : "s"}`,
  marketSection: "Your market & rules",
  trialEnding: (daysLeft, pricingUrl) =>
    daysLeft <= 1
      ? `Your free Pro trial ends today. After that you keep 3 targets and a weekly digest — nothing is deleted. Plans: ${pricingUrl}`
      : `Your free Pro trial ends in ${daysLeft} days. After that you keep 3 targets and a weekly digest — nothing is deleted. Plans: ${pricingUrl}`,
  winback: (code, pricingUrl) =>
    `It has been a month since your Mifluent plan ended. If you want it back: code ${code} takes 40% off for two months, for the next 7 days. ${pricingUrl}?code=${code}`,
  startFromLink: (kind, url) =>
    kind === "ref"
      ? `Hi! Set up Mifluent through this link — your friend's bonus (28 days of Pro free) is applied on its own: ${url}`
      : `Hi! Your code is saved. Set up Mifluent through this link and it is applied at checkout: ${url}`,
  more: (count) => `and ${count} more`,
  summary: (changes, targets, market) =>
    [
      changes > 0
        ? `${changes} change${changes === 1 ? "" : "s"} at ${targets} ${targets === 1 ? "company" : "companies"}`
        : "",
      market > 0 ? `${market} about your market & rules` : "",
    ]
      .filter((part) => part !== "")
      .join(" · "),
  kindLabel: (kind) =>
    ({
      price: "price",
      plan: "plan",
      feature: "feature",
      policy: "rule",
      market_rule: "rule",
      hiring: "hiring",
      incident: "incident",
      news: "news",
    })[kind] ?? "change",
  help: "Your brief arrives here every morning.\n\n/watch <link> — watch a page for changes\n/start <code> — send another profile's brief to this chat\n\nEverything else — in the app: archive, targets, settings.",
  emptyDigest: (period, sources, items) =>
    `Quiet for ${period}: nothing that concerns you.\nChecked ${sources} sources, ${items} items.`,
  emptyDigestFirstWeek: (sources, items, closestTitle) =>
    `First week: nothing important yet. Checked ${sources} sources, ${items} items.\nClosest: ${closestTitle}.`,
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
    notFollowing: "Unfollow",
    notImportant: "Not important",
    save: "Save",
    influenced: "Changed a decision",
    openMiniApp: "Archive & settings",
    openTarget: "history",
    fullReport: "Full report",
  },
  callback: {
    recorded: "Noted",
    notFound: "That card is no longer available",
    influencedPrompt: "What did you decide? Reply with one line.",
    influencedEmpty: "Empty reply. Press the button again to try.",
    influencedFailed: "Could not record. Press the button again.",
    influencedRecorded: (target) => `Recorded. I'll show it in the history for ${target}.`,
  },
  binding: {
    bound: (profile) => `Done. Digests for “${profile}” will arrive here.`,
    invalidCode: "That code is not valid or has expired. Get a new one in Mifluent.",
    help: "Send /start followed by the code from the app to get the brief in this chat.",
    firstDigestCollecting: "Collecting your first digest. It will arrive in a few minutes.",
  },
  onboarding: {
    closedRegistration: "The bot is invite-only for now. Do you have an invitation code?",
    awaitingInput: "Send your website address or a one-sentence description of your business.",
    discoveryProgress: (progressText) => `Reading your site… ${progressText}`,
    businessFacts: "Business facts",
    noDescription: "No description provided",
    targets: "Targets to track",
    targetLimit: (max) => `You can select up to ${max} targets.`,
    listingActions: "Tap a target to toggle. Then press “Go” to continue.",
    go: "Go",
    addCompetitor: "Add competitor",
    chooseTimezone: "Choose your timezone:",
    otherTimezone: "Other (I'll type it)",
    progressReadingSite: "Reading the website…",
    progressFindingCompetitors: "Finding competitors…",
    progressCheckingBlogs: "Checking for blogs and pricing pages…",
    progressCheckingPrices: "Checking pricing pages…",
    progressAlmostDone: "Almost done…",
  },
  watch: {
    help: "Send /watch followed by a URL to start watching a page for changes. Example: /watch https://competitor.com/pricing",
    baselineRecorded: "Got it. I've saved the page and will let you know when it changes.",
    cannotRead:
      "I can't read that page — it may require a login or use JavaScript to render. Try a public page instead.",
    limitReached: (limit) =>
      `You've reached the limit of ${limit} watched pages for your plan. Remove one or upgrade to watch more.`,
  },
  monthly: {
    stats: (p) =>
      [
        p.active + p.quiet > 0 ? `${p.active} active, ${p.quiet} quiet` : "",
        p.prices > 0 ? `${p.prices} price change${p.prices === 1 ? "" : "s"}` : "",
        p.hiring > 0 ? `${p.hiring} hiring` : "",
        p.decisions > 0 ? `${p.decisions} decision${p.decisions === 1 ? "" : "s"}` : "",
        p.drifted > 0 ? `${p.drifted} to review` : "",
      ].filter((part) => part !== ""),
    title: (profile, month) => `${profile} — month in review, ${month}`,
    shortTitle: (profile, month) => `${profile} — ${month} summary`,
    proOnly: "Full monthly report is a Pro feature.",
    topEvents: "Top events of the month",
    perTarget: "Per target",
    priceChanges: "Price & plan changes",
    hiring: "Hiring activity",
    decisions: "Your decisions",
    drift: "Targets to review (60+ days quiet)",
    noEvents: "No significant events this month.",
    quiet: "quiet",
    eventsCount: (count) => `${count} event${count === 1 ? "" : "s"}`,
    priceChangeRow: (target, kind, was, became) => `${target} (${kind}): ${was ?? "—"} → ${became}`,
    hiringRow: (target, open, newCount) =>
      `${target}: ${open} open${newCount > 0 ? `, ${newCount} new` : ""}`,
    decisionCount: (count) => `${count} decision${count === 1 ? "" : "s"} recorded`,
    driftedTarget: (target, days) => `${target} — no activity for ${days} days`,
    sourcesChecked: (sources, items) => `Checked ${sources} sources, ${items} items.`,
    introLabel: "Summary",
  },
};

const ru: Strings = {
  digestTitle: (profile, period) => `${profile} — ${period}`,
  urgentTitle: (profile) => `Срочно — ${profile}`,
  age: (days) => (days === 0 ? "сегодня" : days === 1 ? "вчера" : `${days} дн. назад`),
  whyItMatters: "Почему касается:",
  modelInterpretation: "Интерпретация модели ⚠",
  source: "источник",
  groupHeadline: (target, count) =>
    `${target}: ${count} ${ruPlural(count, "изменение", "изменения", "изменений")}`,
  marketSection: "В твоей стране и нише",
  trialEnding: (daysLeft, pricingUrl) =>
    daysLeft <= 1
      ? `Бесплатный Pro заканчивается сегодня. Дальше — 3 цели и сводка раз в неделю, ничего не удаляется. Тарифы: ${pricingUrl}`
      : `Бесплатный Pro закончится через ${daysLeft} ${ruPlural(daysLeft, "день", "дня", "дней")}. Дальше — 3 цели и сводка раз в неделю, ничего не удаляется. Тарифы: ${pricingUrl}`,
  winback: (code, pricingUrl) =>
    `Месяц назад закончился твой тариф Mifluent. Если захочешь вернуться: промокод ${code} — минус 40% на два месяца, действует 7 дней. ${pricingUrl}?code=${code}`,
  startFromLink: (kind, url) =>
    kind === "ref"
      ? `Привет! Настрой Mifluent по этой ссылке — бонус от друга (28 дней Pro бесплатно) применится сам: ${url}`
      : `Привет! Промокод сохранён. Настрой Mifluent по этой ссылке — скидка применится при оплате: ${url}`,
  selfGroupHeadline: (count) =>
    `О тебе: ${count} упоминани${count === 1 ? "е" : count < 5 ? "я" : "й"}`,
  more: (count) => `и ещё ${count}`,
  summary: (changes, targets, market) =>
    [
      changes > 0
        ? `${changes} ${ruPlural(changes, "изменение", "изменения", "изменений")} у ${targets} ${ruPlural(targets, "компании", "компаний", "компаний")}`
        : "",
      market > 0 ? `${market} по рынку и правилам` : "",
    ]
      .filter((part) => part !== "")
      .join(" · "),
  kindLabel: (kind) =>
    ({
      price: "цена",
      plan: "тариф",
      feature: "функция",
      policy: "правило",
      market_rule: "правило",
      hiring: "найм",
      incident: "сбой",
      news: "новость",
    })[kind] ?? "изменение",
  help: "Сводка приходит сюда каждое утро.\n\n/watch <ссылка> — следить за страницей\n/start <код> — присылать сюда сводку другого профиля\n\nОстальное — в приложении: архив, цели, настройки.",
  emptyDigest: (period, sources, items) =>
    `Тихо за ${period}: ничего, что тебя касается.\nПроверено ${sources} ${ruPlural(sources, "источник", "источника", "источников")}, ${items} ${ruPlural(items, "материал", "материала", "материалов")}.`,
  emptyDigestFirstWeek: (sources, items, closestTitle) =>
    `Первая неделя: пока ничего важного. Проверено ${sources} ${ruPlural(sources, "источник", "источника", "источников")}, ${items} ${ruPlural(items, "материал", "материала", "материалов")}.\nБлиже всего: ${closestTitle}.`,
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
      "Обработка на паузе до завтра: исчерпан дневной бюджет. Свой ключ модели можно указать в настройках.",
    targetQuiet: (target) => `У ${target} тише обычного.`,
  },
  buttons: {
    notFollowing: "Не следить",
    notImportant: "Не важно",
    save: "Сохранить",
    influenced: "Повлияло",
    openMiniApp: "Архив и настройки",
    openTarget: "история",
    fullReport: "Полный отчёт",
  },
  callback: {
    recorded: "Принято",
    notFound: "Эта карточка больше недоступна",
    influencedPrompt: "Что ты решил? Ответь одной строкой.",
    influencedEmpty: "Пустой ответ. Нажми кнопку ещё раз.",
    influencedFailed: "Не удалось записать. Нажми кнопку ещё раз.",
    influencedRecorded: (target) => `Записал. Покажу в истории по ${target}.`,
  },
  binding: {
    bound: (profile) => `Готово. Сводки по «${profile}» будут приходить сюда.`,
    invalidCode: "Код неверный или истёк. Возьми новый в приложении.",
    help: "Отправь /start и код из приложения — и сводка будет приходить в этот чат.",
    firstDigestCollecting: "Собираю первую сводку — придёт через несколько минут.",
  },
  onboarding: {
    closedRegistration: "Бот пока по приглашениям. Есть код приглашения?",
    awaitingInput: "Пришли адрес своего сайта или одно предложение о бизнесе.",
    discoveryProgress: (progressText) => `Читаю сайт… ${progressText}`,
    businessFacts: "Факты о бизнесе",
    noDescription: "Описание не указано",
    targets: "Цели для отслеживания",
    targetLimit: (max) => `Можно выбрать до ${max} целей.`,
    listingActions: "Нажми на цель, чтобы включить/выключить. Потом «Поехали».",
    go: "Поехали",
    addCompetitor: "Добавить конкурента",
    chooseTimezone: "Выбери часовой пояс:",
    otherTimezone: "Другой (напишу сам)",
    progressReadingSite: "Читаю сайт…",
    progressFindingCompetitors: "Ищу конкурентов…",
    progressCheckingBlogs: "Проверяю, где блог и цены…",
    progressCheckingPrices: "Проверяю страницы цен…",
    progressAlmostDone: "Почти готово…",
  },
  watch: {
    help: "Пришли /watch и ссылку, чтобы начать следить за страницей. Пример: /watch https://competitor.com/pricing",
    baselineRecorded: "Понял. Запомнил страницу, пришлю, когда изменится.",
    cannotRead:
      "Не могу прочитать эту страницу — возможно, она за логином или рендерится через JavaScript. Попробуй публичную страницу.",
    limitReached: (limit) =>
      `Лимит отслеживаемых страниц для твоего тарифа — ${limit}. Удали одну или смени тариф, чтобы добавить больше.`,
  },
  monthly: {
    stats: (p) =>
      [
        p.active + p.quiet > 0 ? `${p.active} активны, ${p.quiet} тихо` : "",
        p.prices > 0
          ? `${p.prices} ${ruPlural(p.prices, "изменение цены", "изменения цен", "изменений цен")}`
          : "",
        p.hiring > 0 ? `найм: ${p.hiring}` : "",
        p.decisions > 0
          ? `${p.decisions} ${ruPlural(p.decisions, "решение", "решения", "решений")}`
          : "",
        p.drifted > 0 ? `${p.drifted} проверить` : "",
      ].filter((part) => part !== ""),
    title: (profile, month) => `${profile} — итоги месяца, ${month}`,
    shortTitle: (profile, month) => `${profile} — итоги ${month}`,
    proOnly: "Полный ежемесячный отчёт — в Pro.",
    topEvents: "Главные события месяца",
    perTarget: "По целям",
    priceChanges: "Изменения цен и планов",
    hiring: "Найм",
    decisions: "Твои решения",
    drift: "Цели без активности 60+ дней — убрать?",
    noEvents: "За месяц значимых событий не было.",
    quiet: "тихо",
    eventsCount: (count) => `${count} событи${count === 1 ? "е" : count < 5 ? "я" : "й"}`,
    priceChangeRow: (target, kind, was, became) => `${target} (${kind}): ${was ?? "—"} → ${became}`,
    hiringRow: (target, open, newCount) =>
      `${target}: ${open} открыт${open === 1 ? "а" : open < 5 ? "ы" : ""}${newCount > 0 ? `, ${newCount} новых` : ""}`,
    decisionCount: (count) =>
      `Зафиксировано ${count} решени${count === 1 ? "е" : count < 5 ? "я" : "й"}`,
    driftedTarget: (target, days) => `${target} — без активности ${days} дн.`,
    sourcesChecked: (sources, items) => `Проверено ${sources} источников, ${items} материалов.`,
    introLabel: "Суть",
  },
};

/** 1 источник, 2 источника, 5 источников. */
export function ruPlural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

export function stringsFor(language: Language): Strings {
  return language === "ru" ? ru : en;
}

/** "21 Sep — 28 Sep 2026", in the reader's language and zone; the year once. */
export function formatPeriod(start: Date, end: Date, language: Language, timezone: string): string {
  const locale = language === "ru" ? "ru-RU" : "en-GB";
  const full = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  });
  const to = full.format(end);
  const from = full.format(start);
  if (from === to) return to;
  const year = (date: Date) =>
    new Intl.DateTimeFormat("en", { year: "numeric", timeZone: timezone }).format(date);
  const short = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  });
  return `${year(start) === year(end) ? short.format(start) : from} — ${to}`;
}
