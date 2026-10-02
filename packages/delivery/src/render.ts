/**
 * A digest as Telegram messages.
 *
 * One message for the header — period, notices, and on an empty week the
 * report of what was checked — then one message per card, because the three
 * feedback buttons belong to a card and Telegram attaches buttons to a message.
 * That also keeps every message far below Telegram's length limit; a card that
 * somehow exceeds it loses its trailing blocks rather than being split mid-quote.
 */

import type { DigestBlockView, DigestCardView, DigestView } from "@mifluent/digest";
import { escapeHtml, link } from "./html.js";
import { formatPeriod, type Strings, stringsFor } from "./strings.js";
import { type InlineButton, MAX_MESSAGE_LENGTH, type OutgoingMessage } from "./telegram-api.js";

export interface RenderOptions {
  /** Where "and N more" points for a folded card. */
  readonly appUrl: string;
  /** The reader's zone, for the dates in the header. */
  readonly timezone: string;
  /** URL for the Mini App web_app button. */
  readonly miniAppUrl?: string;
}

export function renderDigest(digest: DigestView, options: RenderOptions): OutgoingMessage[] {
  const strings = stringsFor(digest.language);
  const header = renderHeader(digest, strings, options);
  const cards: OutgoingMessage[] = [];
  let isMarketStarted = false;
  for (const card of digest.cards) {
    // One heading message before the first card of the market section, so a
    // law or platform rule is never read as news about a competitor.
    if (card.section === "market" && !isMarketStarted) {
      isMarketStarted = true;
      cards.push({ text: `<b>${escapeHtml(strings.marketSection)}</b>` });
    }
    cards.push(renderCard(card, strings, options));
  }
  return [header, ...cards];
}

/** Render a monthly report as a short Telegram message with a "Full report" button. */
export interface MonthlyReportRenderOptions {
  readonly appUrl: string;
  readonly timezone: string;
  readonly miniAppUrl?: string;
  readonly isPro: boolean;
  readonly reportUrl: string; // Web URL for the full report
}

export interface MonthlyReportData {
  readonly month: string; // "YYYY-MM"
  readonly profileName: string;
  readonly language: "en" | "ru";
  readonly topEvents: readonly {
    readonly targetName: string | null;
    readonly kind: string | null;
    readonly summary: string;
  }[];
  readonly targetSummaries: readonly {
    readonly targetName: string;
    readonly oneLiner: string;
    readonly isQuiet: boolean;
  }[];
  readonly priceChangesCount: number;
  readonly hiringCount: number;
  readonly decisionsCount: number;
  readonly driftedCount: number;
  readonly intro: readonly { readonly text: string }[] | null;
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
}

export function renderMonthlyReportTelegram(
  report: MonthlyReportData,
  options: MonthlyReportRenderOptions,
): OutgoingMessage[] {
  const strings = stringsFor(report.language);
  const monthLabel = formatMonthLabel(report.month, report.language);
  const title = buildMonthlyReportTitle(report.profileName, monthLabel, strings, options.isPro);

  const lines = buildMonthlyReportLines(report, strings, options.isPro);
  lines.unshift(`<b>${escapeHtml(title)}</b>`);

  const buttons = buildMonthlyReportButtons(strings, options);

  return [{ text: fitToLimit(lines), buttons }];
}

function buildMonthlyReportTitle(
  profileName: string,
  monthLabel: string,
  strings: Strings,
  isPro: boolean,
): string {
  return isPro
    ? strings.monthly.title(profileName, monthLabel)
    : strings.monthly.shortTitle(profileName, monthLabel);
}

function buildMonthlyReportLines(
  report: MonthlyReportData,
  strings: Strings,
  isPro: boolean,
): string[] {
  const lines: string[] = [];

  // Intro from model (if available)
  if (report.intro !== null && report.intro.length > 0) {
    lines.push("", `<b>${escapeHtml(strings.monthly.introLabel)}</b>`);
    for (const sentence of report.intro) {
      lines.push(escapeHtml(sentence.text));
    }
  }

  // Top events (max 3 for short version)
  if (report.topEvents.length > 0) {
    lines.push("", `<b>${escapeHtml(strings.monthly.topEvents)}</b>`);
    for (const event of report.topEvents.slice(0, 3)) {
      const target = event.targetName ?? strings.monthly.perTarget;
      const kind = strings.kindLabel(event.kind ?? "other");
      lines.push(
        `• <b>${escapeHtml(target)}</b> (${escapeHtml(kind)}): ${escapeHtml(event.summary)}`,
      );
    }
  }

  // Quick stats line
  const statsParts = buildStatsParts(report, strings);
  if (statsParts.length > 0) {
    lines.push("", `<i>${escapeHtml(statsParts.join(" · "))}</i>`);
  }

  // Sources checked
  lines.push(
    "",
    escapeHtml(strings.monthly.sourcesChecked(report.sourcesChecked, report.itemsConsidered)),
  );

  // Pro notice for free users
  if (!isPro) {
    lines.push("", `<i>${escapeHtml(strings.monthly.proOnly)}</i>`);
  }

  return lines;
}

function buildStatsParts(report: MonthlyReportData, strings: Strings): string[] {
  const quiet = report.targetSummaries.filter((target) => target.isQuiet).length;
  return strings.monthly.stats({
    active: report.targetSummaries.length - quiet,
    quiet,
    prices: report.priceChangesCount,
    hiring: report.hiringCount,
    decisions: report.decisionsCount,
    drifted: report.driftedCount,
  });
}

function buildMonthlyReportButtons(
  strings: Strings,
  options: MonthlyReportRenderOptions,
): readonly InlineButton[] {
  const buttons: InlineButton[] = [
    { type: "web_app", text: strings.buttons.fullReport, webAppUrl: options.reportUrl },
  ];

  if (options.miniAppUrl) {
    buttons.push({
      type: "web_app",
      text: strings.buttons.openMiniApp,
      webAppUrl: options.miniAppUrl,
    });
  }

  return buttons;
}

function formatMonthLabel(month: string, language: "en" | "ru"): string {
  const [yearStr, monthStr] = month.split("-") as [string, string];
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  const format = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.format(date);
}

function renderHeader(
  digest: DigestView,
  strings: Strings,
  options: RenderOptions,
): OutgoingMessage {
  const period = formatPeriod(
    digest.periodStart,
    digest.periodEnd,
    digest.language,
    options.timezone,
  );
  const title = digest.isUrgent
    ? strings.urgentTitle(digest.profileName)
    : strings.digestTitle(digest.profileName, period);

  const lines = [`<b>${escapeHtml(title)}</b>`];
  const summary = summarise(digest, strings);
  if (summary !== "") lines.push(escapeHtml(summary));

  for (const notice of digest.notices) {
    lines.push("", escapeHtml(noticeText(notice, strings)));
  }

  if (digest.cards.length === 0) {
    lines.push("", renderEmptyDigest(digest, strings, period));
  }

  // Add web_app button to open Mini App for archive and settings
  const buttons: readonly InlineButton[] | undefined = options.miniAppUrl
    ? [{ type: "web_app", text: strings.buttons.openMiniApp, webAppUrl: options.miniAppUrl }]
    : undefined;

  return { text: fitToLimit(lines), buttons };
}

/**
 * A quiet week in two lines, no apology. The links of the near misses are
 * HTML already; only the text around them is escaped.
 */
function renderEmptyDigest(digest: DigestView, strings: Strings, period: string): string {
  const isFirstWeek = Date.now() - digest.profileCreatedAt.getTime() < 7 * 24 * 60 * 60 * 1000;
  const closest = digest.nearMisses.at(0);
  if (isFirstWeek && closest !== undefined) {
    return escapeHtml(
      strings.emptyDigestFirstWeek(
        digest.sourcesChecked,
        digest.itemsConsidered,
        closest.title === "" ? "—" : closest.title,
      ),
    );
  }

  const lines = [
    escapeHtml(strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered)),
  ];
  if (digest.nearMisses.length > 0) {
    lines.push("", escapeHtml(strings.closest));
    for (const miss of digest.nearMisses) {
      const title = link(miss.url, miss.title === "" ? "—" : miss.title);
      lines.push(
        `• ${title} — ${escapeHtml(strings.rejectedBecause)} ${escapeHtml(strings.rejectionReason(miss.reason))}`,
      );
    }
  }
  return lines.join("\n");
}

/** "3 changes at 2 companies · 1 about your market", from the cards themselves. */
function summarise(digest: DigestView, strings: Strings): string {
  if (digest.isUrgent || digest.cards.length === 0) return "";
  const main = digest.cards.filter((card) => card.section === "main");
  const market = digest.cards.length - main.length;
  const changes = main.reduce(
    (sum, card) =>
      sum + Math.max(1, card.blocks.filter((b) => b.kind === "fact").length) + card.moreCount,
    0,
  );
  const targets = new Set(main.map((card) => card.targetId ?? card.id)).size;
  return strings.summary(changes, targets, market);
}

/** A type marker, not decoration: what kind of change this is, at a glance. */
function marker(card: DigestCardView): string {
  if (card.targetKind === "self") return "👀 ";
  switch (card.eventKind) {
    case "price":
    case "plan":
      return "💰 ";
    case "policy":
    case "market_rule":
      return "📜 ";
    case "feature":
      return "🚀 ";
    default:
      return "";
  }
}

function renderCard(
  card: DigestCardView,
  strings: Strings,
  options: RenderOptions,
): OutgoingMessage {
  const isSelfTarget = card.targetKind === "self";
  const headline =
    card.kind === "group"
      ? isSelfTarget
        ? strings.selfGroupHeadline(card.blocks.length + card.moreCount)
        : strings.groupHeadline(card.headline, card.blocks.length + card.moreCount)
      : card.headline;
  const age = card.ageDays === null ? "" : ` · <i>${escapeHtml(strings.age(card.ageDays))}</i>`;

  const lines = [`${marker(card)}<b>${escapeHtml(headline)}</b>${age}`];
  for (const block of card.blocks) {
    lines.push(renderBlock(block, strings));
  }

  // One footer line: more of the same, and the target's history.
  const base = options.appUrl.replace(/\/+$/, "");
  const footer: string[] = [];
  if (card.moreCount > 0) footer.push(link(`${base}/today`, strings.more(card.moreCount)));
  if (card.targetId !== null && card.targetKind !== "self") {
    footer.push(link(`${base}/targets/${card.targetId}`, strings.buttons.openTarget));
  }
  if (footer.length > 0) lines.push(footer.join(" · "));

  return {
    text: fitToLimit(lines),
    buttons: [
      {
        type: "callback",
        text: strings.buttons.notFollowing,
        callbackData: `not_following_target:${card.id}`,
      },
      {
        type: "callback",
        text: strings.buttons.notImportant,
        callbackData: `not_important:${card.id}`,
      },
      { type: "callback", text: strings.buttons.save, callbackData: `saved:${card.id}` },
      { type: "callback", text: strings.buttons.influenced, callbackData: `influenced:${card.id}` },
    ],
  };
}

function renderBlock(block: DigestBlockView, strings: Strings): string {
  switch (block.kind) {
    case "fact": {
      const quote = block.quote === null ? "" : `\n<i>«${escapeHtml(block.quote)}»</i>`;
      const source = block.sourceUrl === null ? "" : ` — ${link(block.sourceUrl, strings.source)}`;
      return `${escapeHtml(block.content)}${quote}${source}`;
    }
    case "implication":
      return `<b>${escapeHtml(strings.whyItMatters)}</b> ${escapeHtml(block.content)}`;
    case "model_interpretation":
      return `<b>${escapeHtml(strings.modelInterpretation)}:</b> ${escapeHtml(block.content)}`;
    case "analyst_opinion":
      return escapeHtml(block.content);
  }
}

function noticeText(notice: DigestView["notices"][number], strings: Strings): string {
  switch (notice.code) {
    case "baseline_recorded":
      return strings.notices.baselineRecorded;
    case "cost_cap_reached":
      return strings.notices.costCapReached;
    case "target_quiet":
      return strings.notices.targetQuiet(notice.targetName);
  }
}

/**
 * Drop whole trailing lines until the message fits. Cutting inside a line
 * could leave an unclosed tag, which Telegram rejects outright.
 */
function fitToLimit(lines: readonly string[]): string {
  const kept = [...lines];
  while (kept.length > 1 && kept.join("\n").length > MAX_MESSAGE_LENGTH) {
    kept.pop();
  }
  const text = kept.join("\n");
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : text;
}
