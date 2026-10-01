/**
 * Email rendering for digests.
 *
 * Produces both HTML and plain text versions. The HTML version mirrors the
 * Telegram card layout: grouped by target, with source links via /r/<cardId>,
 * and action buttons as links to /a/<token>. The plain text version is a
 * readable fallback.
 *
 * No tracking pixel — clicks are counted via the /r/ redirect and /a/ actions.
 */

import type { DigestView } from "@mifluent/digest";
import { escapeHtml } from "../html.js";
import { formatPeriod, type Language, type Strings, stringsFor } from "../strings.js";

export interface EmailRenderOptions {
  readonly appUrl: string;
  readonly timezone: string;
  /** A signed link to the confirmation page for one button under one card. */
  readonly actionUrl: (cardId: string, action: EmailCardAction) => string;
  /** A signed link that stops email delivery for the digest's profile. */
  readonly unsubscribeUrl: string;
  readonly feedbackEmail: string;
}

const EMAIL_CARD_ACTIONS = [
  "not_following_target",
  "not_important",
  "saved",
  "influenced",
] as const;

export type EmailCardAction = (typeof EMAIL_CARD_ACTIONS)[number];

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Monthly report data for email rendering. */
export interface MonthlyReportEmailData {
  readonly month: string; // "YYYY-MM"
  readonly profileName: string;
  readonly language: Language;
  readonly isPro: boolean;
  readonly topEvents: readonly {
    readonly targetName: string | null;
    readonly kind: string | null;
    readonly summary: string;
    readonly sourceUrl: string | null;
    readonly occurredAt: Date;
  }[];
  readonly targetSummaries: readonly {
    readonly targetName: string;
    readonly targetKind: string;
    readonly oneLiner: string;
    readonly isQuiet: boolean;
  }[];
  readonly priceChanges: readonly {
    readonly targetName: string;
    readonly kind: "price" | "plan";
    readonly was: string | null;
    readonly became: string;
    readonly sourceUrl: string | null;
    readonly occurredAt: Date;
  }[];
  readonly hiringSummaries: readonly {
    readonly targetName: string;
    readonly openCount: number;
    readonly newThisMonth: number;
    readonly departments: readonly string[];
  }[];
  readonly decisionsCount: number;
  readonly driftedTargets: readonly {
    readonly targetName: string;
    readonly targetKind: string;
    readonly daysSinceActivity: number;
  }[];
  readonly intro: readonly { readonly text: string }[] | null;
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
}

const ACTION_LABELS: Readonly<Record<string, { en: string; ru: string }>> = {
  not_following_target: { en: "Not following this", ru: "Не слежу за этим" },
  not_important: { en: "Not important", ru: "Не важно" },
  saved: { en: "Save", ru: "Сохранить" },
  influenced: { en: "It changed a decision", ru: "Повлияло" },
};

function actionLabel(action: string, language: Language): string {
  return ACTION_LABELS[action]?.[language] ?? action;
}

function renderSubject(digest: DigestView): string {
  const period = formatPeriod(digest.periodStart, digest.periodEnd, digest.language, "UTC");

  if (digest.cards.length === 0) {
    return `Mifluent: quiet week, ${digest.sourcesChecked} sources checked`;
  }

  const count = digest.cards.length;
  const profile = digest.profileName;
  return `Mifluent: ${count} change${count === 1 ? "" : "s"} at ${profile} — week of ${period.split(" — ")[1] ?? period}`;
}

function renderHtmlHeader(digest: DigestView, strings: ReturnType<typeof stringsFor>): string {
  const period = formatPeriod(digest.periodStart, digest.periodEnd, digest.language, "UTC");
  const title = digest.isUrgent
    ? strings.urgentTitle(digest.profileName)
    : strings.digestTitle(digest.profileName, period);

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 16px; color: #1a1a1a;">${escapeHtml(title)}</h1>
  `;
}

function renderHtmlNotice(
  notice: DigestView["notices"][number],
  strings: ReturnType<typeof stringsFor>,
): string {
  let text = "";
  switch (notice.code) {
    case "baseline_recorded":
      text = strings.notices.baselineRecorded;
      break;
    case "cost_cap_reached":
      text = strings.notices.costCapReached;
      break;
    case "target_quiet":
      text = strings.notices.targetQuiet(notice.targetName);
      break;
  }
  return `<p style="margin: 16px 0; padding: 12px; background: #f5f5f5; border-radius: 4px; font-size: 14px;">${escapeHtml(text)}</p>`;
}

function renderHtmlEmptyDigest(
  digest: DigestView,
  strings: ReturnType<typeof stringsFor>,
  period: string,
): string {
  const isFirstWeek = Date.now() - digest.profileCreatedAt.getTime() < 7 * 24 * 60 * 60 * 1000;
  if (isFirstWeek && digest.nearMisses.length > 0) {
    const closest = digest.nearMisses[0];
    const closestTitle = closest?.title === "" ? "—" : (closest?.title ?? "—");
    return `
      <p>${escapeHtml(strings.emptyDigestFirstWeek(digest.sourcesChecked, digest.itemsConsidered, closestTitle))}</p>
    `;
  }

  let html = `<p>${escapeHtml(strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered))}</p>`;
  if (digest.nearMisses.length > 0) {
    html += `<p><strong>${escapeHtml(strings.closest)}</strong></p><ul>`;
    for (const miss of digest.nearMisses) {
      const title = miss.title === "" ? "—" : miss.title;
      const url = miss.url
        ? `<a href="${escapeHtml(miss.url)}" style="color: #0066cc;">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      html += `<li>${url} — ${escapeHtml(strings.rejectedBecause)} ${escapeHtml(strings.rejectionReason(miss.reason))}</li>`;
    }
    html += `</ul>`;
  }
  return html;
}

function renderHtmlBlock(
  block: DigestView["cards"][number]["blocks"][number],
  strings: ReturnType<typeof stringsFor>,
): string {
  switch (block.kind) {
    case "fact": {
      const quote =
        block.quote === null
          ? ""
          : `<blockquote style="margin: 8px 0; padding: 8px 12px; border-left: 3px solid #ddd; color: #555; font-style: italic;">${escapeHtml(block.quote)}</blockquote>`;
      const source =
        block.sourceUrl === null
          ? ""
          : `<p style="margin: 8px 0 0; font-size: 13px; color: #666;"><a href="${escapeHtml(block.sourceUrl)}" style="color: #0066cc;">${strings.source}</a></p>`;
      return `<p style="margin: 8px 0;">${escapeHtml(block.content)}${quote}${source}</p>`;
    }
    case "implication":
      return `<p style="margin: 8px 0;"><strong>${escapeHtml(strings.whyItMatters)}</strong> ${escapeHtml(block.content)}</p>`;
    case "model_interpretation":
      return `<p style="margin: 8px 0;"><strong>${escapeHtml(strings.modelInterpretation)}:</strong> ${escapeHtml(block.content)}</p>`;
    case "analyst_opinion":
      return `<p style="margin: 8px 0;">${escapeHtml(block.content)}</p>`;
  }
}

function renderHtmlCard(
  card: DigestView["cards"][number],
  strings: ReturnType<typeof stringsFor>,
  options: EmailRenderOptions,
  language: Language,
): string {
  const headline =
    card.kind === "group"
      ? strings.groupHeadline(card.headline, card.blocks.length + card.moreCount)
      : card.headline;
  const age =
    card.ageDays === null
      ? ""
      : ` <span style="color: #888; font-size: 13px;">(${escapeHtml(strings.age(card.ageDays))})</span>`;

  let html = `
    <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #1a1a1a;">${escapeHtml(headline)}${age}</h2>
  `;

  for (const block of card.blocks) {
    html += renderHtmlBlock(block, strings);
  }

  if (card.moreCount > 0) {
    const moreUrl = `${options.appUrl.replace(/\/+$/, "")}/today`;
    html += `<p style="margin: 16px 0 0;"><a href="${escapeHtml(moreUrl)}" style="color: #0066cc;">${escapeHtml(strings.more(card.moreCount))}</a></p>`;
  }

  // Action buttons as links
  html += `<div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #eee;">`;
  for (const action of EMAIL_CARD_ACTIONS) {
    const actionUrl = options.actionUrl(card.id, action);
    html += `
      <a href="${escapeHtml(actionUrl)}" style="display: inline-block; margin: 4px 8px 4px 0; padding: 8px 16px; background: #f0f0f0; border-radius: 4px; color: #1a1a1a; text-decoration: none; font-size: 14px;">
        ${escapeHtml(actionLabel(action, language))}
      </a>
    `;
  }
  html += `</div></div>`;

  return html;
}

function renderHtmlFooter(options: EmailRenderOptions, _language: Language): string {
  return `
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
    <p style="font-size: 12px; color: #888; margin: 0 0 8px;">
      Summaries are AI-generated from the linked sources.
    </p>
    <p style="font-size: 12px; color: #888; margin: 0 0 8px;">
      <a href="${escapeHtml(options.unsubscribeUrl)}" style="color: #888;">Unsubscribe</a>
    </p>
    <p style="font-size: 12px; color: #888; margin: 16px 0 0;">
      Reply to this email — it goes straight to the founder.
    </p>
  </div>
  `;
}

function renderTextHeader(digest: DigestView, strings: ReturnType<typeof stringsFor>): string {
  const period = formatPeriod(digest.periodStart, digest.periodEnd, digest.language, "UTC");
  const title = digest.isUrgent
    ? strings.urgentTitle(digest.profileName)
    : strings.digestTitle(digest.profileName, period);
  return `${title}\n${"=".repeat(title.length)}\n\n`;
}

function renderTextNotice(
  notice: DigestView["notices"][number],
  strings: ReturnType<typeof stringsFor>,
): string {
  let text = "";
  switch (notice.code) {
    case "baseline_recorded":
      text = strings.notices.baselineRecorded;
      break;
    case "cost_cap_reached":
      text = strings.notices.costCapReached;
      break;
    case "target_quiet":
      text = strings.notices.targetQuiet(notice.targetName);
      break;
  }
  return `[${text}]\n\n`;
}

function renderTextEmptyDigest(
  digest: DigestView,
  strings: ReturnType<typeof stringsFor>,
  period: string,
): string {
  const isFirstWeek = Date.now() - digest.profileCreatedAt.getTime() < 7 * 24 * 60 * 60 * 1000;
  if (isFirstWeek && digest.nearMisses.length > 0) {
    const closest = digest.nearMisses[0];
    const closestTitle = closest?.title === "" ? "—" : (closest?.title ?? "—");
    return `${strings.emptyDigestFirstWeek(digest.sourcesChecked, digest.itemsConsidered, closestTitle)}\n\n`;
  }

  let text = `${strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered)}\n`;
  if (digest.nearMisses.length > 0) {
    text += `\n${strings.closest}\n`;
    for (const miss of digest.nearMisses) {
      const title = miss.title === "" ? "—" : miss.title;
      text += `• ${title} — ${strings.rejectedBecause} ${strings.rejectionReason(miss.reason)}\n`;
    }
  }
  return `${text}\n`;
}

function renderTextBlock(
  block: DigestView["cards"][number]["blocks"][number],
  strings: ReturnType<typeof stringsFor>,
): string {
  switch (block.kind) {
    case "fact": {
      const quote = block.quote === null ? "" : `\n  "${block.quote}"`;
      const source = block.sourceUrl === null ? "" : `\n  Source: ${block.sourceUrl}`;
      return `${block.content}${quote}${source}\n`;
    }
    case "implication":
      return `${strings.whyItMatters} ${block.content}\n`;
    case "model_interpretation":
      return `${strings.modelInterpretation}: ${block.content}\n`;
    case "analyst_opinion":
      return `${block.content}\n`;
  }
}

function renderTextCard(
  card: DigestView["cards"][number],
  strings: ReturnType<typeof stringsFor>,
  options: EmailRenderOptions,
  language: Language,
): string {
  const headline =
    card.kind === "group"
      ? strings.groupHeadline(card.headline, card.blocks.length + card.moreCount)
      : card.headline;
  const age = card.ageDays === null ? "" : ` (${strings.age(card.ageDays)})`;

  let text = `${headline}${age}\n${"-".repeat(headline.length + age.length)}\n\n`;

  for (const block of card.blocks) {
    text += renderTextBlock(block, strings);
  }

  if (card.moreCount > 0) {
    const moreUrl = `${options.appUrl.replace(/\/+$/, "")}/today`;
    text += `\n${strings.more(card.moreCount)}: ${moreUrl}\n`;
  }

  // Action links
  text += "\nActions:\n";
  for (const action of EMAIL_CARD_ACTIONS) {
    const actionUrl = options.actionUrl(card.id, action);
    text += `  ${actionLabel(action, language)}: ${actionUrl}\n`;
  }

  return `${text}\n`;
}

function renderTextFooter(options: EmailRenderOptions, _language: Language): string {
  return `
-------------------------------
Summaries are AI-generated from the linked sources.
Unsubscribe: ${options.unsubscribeUrl}
Reply to this email — it goes straight to the founder.
`;
}

/** Format month label for display. */
function formatMonthLabel(month: string, language: Language): string {
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

/** Format date for display. */
function formatDate(date: Date, language: Language): string {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Build HTML section header. */
function htmlSectionHeader(title: string): string {
  return `<h2 style="font-size: 18px; font-weight: 600; margin: 24px 0 12px; color: #1a1a1a;">${escapeHtml(title)}</h2>`;
}

/** Build text section header. */
function textSectionHeader(title: string): string {
  return `${title}\n${"-".repeat(title.length)}\n`;
}

/** Render intro section for HTML. */
function renderHtmlIntro(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.intro === null || report.intro.length === 0) return "";
  let html = htmlSectionHeader(strings.monthly.introLabel);
  for (const sentence of report.intro) {
    html += `<p style="margin: 8px 0;">${escapeHtml(sentence.text)}</p>`;
  }
  return html;
}

/** Render intro section for text. */
function renderTextIntro(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.intro === null || report.intro.length === 0) return "";
  let text = textSectionHeader(strings.monthly.introLabel);
  for (const sentence of report.intro) {
    text += `${sentence.text}\n`;
  }
  return `${text}\n`;
}

/** Render top events section for HTML. */
function renderHtmlTopEvents(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.topEvents.length === 0) return "";
  let html = htmlSectionHeader(strings.monthly.topEvents);
  for (const event of report.topEvents) {
    const target = event.targetName ?? "General";
    const kind = event.kind ?? "other";
    const dateStr = formatDate(event.occurredAt, report.language);
    const sourceLink = event.sourceUrl
      ? `<a href="${escapeHtml(event.sourceUrl)}" style="color: #0066cc;">${strings.source}</a>`
      : "";
    html += `
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 12px 0;">
        <p style="margin: 0 0 8px;"><strong>${escapeHtml(target)}</strong> (${escapeHtml(kind)}) <span style="color: #888; font-size: 13px;">${dateStr}</span></p>
        <p style="margin: 0;">${escapeHtml(event.summary)}</p>
        ${sourceLink ? `<p style="margin: 8px 0 0; font-size: 13px; color: #666;">${sourceLink}</p>` : ""}
      </div>
    `;
  }
  return html;
}

/** Render top events section for text. */
function renderTextTopEvents(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.topEvents.length === 0) return "";
  let text = textSectionHeader(strings.monthly.topEvents);
  for (const event of report.topEvents) {
    const target = event.targetName ?? "General";
    const kind = event.kind ?? "other";
    const dateStr = formatDate(event.occurredAt, report.language);
    text += `• ${target} (${kind}) — ${dateStr}: ${event.summary}\n`;
    if (event.sourceUrl) text += `  Source: ${event.sourceUrl}\n`;
  }
  return `${text}\n`;
}

/** Render per-target section for HTML. */
function renderHtmlTargetSummaries(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.targetSummaries.length === 0) return "";
  let html = htmlSectionHeader(strings.monthly.perTarget);
  html += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
  html += `<thead><tr style="border-bottom: 2px solid #eee;"><th style="text-align: left; padding: 8px;">${escapeHtml(strings.monthly.perTarget)}</th><th style="text-align: left; padding: 8px;">Activity</th></tr></thead><tbody>`;
  for (const target of report.targetSummaries) {
    const rowStyle = target.isQuiet ? 'style="color: #888;"' : "";
    html += `<tr ${rowStyle}><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(target.targetName)} <span style="color: #888; font-size: 12px;">(${escapeHtml(target.targetKind)})</span></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(target.oneLiner)}</td></tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

/** Render per-target section for text. */
function renderTextTargetSummaries(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.targetSummaries.length === 0) return "";
  let text = textSectionHeader(strings.monthly.perTarget);
  for (const target of report.targetSummaries) {
    text += `${target.targetName} (${target.targetKind}): ${target.oneLiner}\n`;
  }
  return `${text}\n`;
}

/** Render price changes section for HTML. */
function renderHtmlPriceChanges(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.priceChanges.length === 0) return "";
  let html = htmlSectionHeader(strings.monthly.priceChanges);
  html += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
  html += `<thead><tr style="border-bottom: 2px solid #eee;"><th style="text-align: left; padding: 8px;">Target</th><th style="text-align: left; padding: 8px;">Kind</th><th style="text-align: left; padding: 8px;">Was</th><th style="text-align: left; padding: 8px;">Became</th><th style="text-align: left; padding: 8px;">Date</th></tr></thead><tbody>`;
  for (const change of report.priceChanges) {
    const dateStr = formatDate(change.occurredAt, report.language);
    const sourceLink = change.sourceUrl
      ? `<a href="${escapeHtml(change.sourceUrl)}" style="color: #0066cc; font-size: 12px;">${strings.source}</a>`
      : "";
    html += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(change.targetName)}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(change.kind)}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(change.was ?? "—")}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(change.became)}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${dateStr} ${sourceLink}</td></tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

/** Render price changes section for text. */
function renderTextPriceChanges(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.priceChanges.length === 0) return "";
  let text = textSectionHeader(strings.monthly.priceChanges);
  for (const change of report.priceChanges) {
    const dateStr = formatDate(change.occurredAt, report.language);
    text += `${change.targetName} (${change.kind}): ${change.was ?? "—"} → ${change.became} (${dateStr})\n`;
    if (change.sourceUrl) text += `  Source: ${change.sourceUrl}\n`;
  }
  return `${text}\n`;
}

/** Render hiring section for HTML. */
function renderHtmlHiring(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.hiringSummaries.length === 0) return "";
  let html = htmlSectionHeader(strings.monthly.hiring);
  html += `<table style="width: 100%; border-collapse: collapse; font-size: 14px;">`;
  html += `<thead><tr style="border-bottom: 2px solid #eee;"><th style="text-align: left; padding: 8px;">Target</th><th style="text-align: left; padding: 8px;">Open</th><th style="text-align: left; padding: 8px;">New</th><th style="text-align: left; padding: 8px;">Departments</th></tr></thead><tbody>`;
  for (const hiring of report.hiringSummaries) {
    html += `<tr><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(hiring.targetName)}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${hiring.openCount}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${hiring.newThisMonth}</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(hiring.departments.join(", "))}</td></tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

/** Render hiring section for text. */
function renderTextHiring(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.hiringSummaries.length === 0) return "";
  let text = textSectionHeader(strings.monthly.hiring);
  for (const hiring of report.hiringSummaries) {
    text += `${hiring.targetName}: ${hiring.openCount} open, ${hiring.newThisMonth} new — ${hiring.departments.join(", ")}\n`;
  }
  return `${text}\n`;
}

/** Render decisions section for HTML. */
function renderHtmlDecisions(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.decisionsCount === 0) return "";
  return (
    htmlSectionHeader(strings.monthly.decisions) +
    `<p>${escapeHtml(strings.monthly.decisionCount(report.decisionsCount))}</p>`
  );
}

/** Render decisions section for text. */
function renderTextDecisions(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.decisionsCount === 0) return "";
  return (
    textSectionHeader(strings.monthly.decisions) +
    `${strings.monthly.decisionCount(report.decisionsCount)}\n\n`
  );
}

/** Render drifted targets section for HTML. */
function renderHtmlDrifted(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.driftedTargets.length === 0) return "";
  let html = htmlSectionHeader(strings.monthly.drift);
  html += `<ul>`;
  for (const drift of report.driftedTargets) {
    html += `<li>${escapeHtml(strings.monthly.driftedTarget(drift.targetName, drift.daysSinceActivity))} <span style="color: #888; font-size: 12px;">(${escapeHtml(drift.targetKind)})</span></li>`;
  }
  html += `</ul>`;
  return html;
}

/** Render drifted targets section for text. */
function renderTextDrifted(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.driftedTargets.length === 0) return "";
  let text = textSectionHeader(strings.monthly.drift);
  for (const drift of report.driftedTargets) {
    text += `${strings.monthly.driftedTarget(drift.targetName, drift.daysSinceActivity)} (${drift.targetKind})\n`;
  }
  return `${text}\n`;
}

/** Render sources checked line for HTML. */
function renderHtmlSourcesChecked(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  return `<p style="margin-top: 24px; color: #888; font-size: 13px;">${escapeHtml(strings.monthly.sourcesChecked(report.sourcesChecked, report.itemsConsidered))}</p>`;
}

/** Render sources checked line for text. */
function renderTextSourcesChecked(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  return `${strings.monthly.sourcesChecked(report.sourcesChecked, report.itemsConsidered)}\n`;
}

/** Render Pro notice for HTML. */
function renderHtmlProNotice(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.isPro) return "";
  return `<p style="color: #888; font-size: 13px;"><em>${escapeHtml(strings.monthly.proOnly)}</em></p>`;
}

/** Render Pro notice for text. */
function renderTextProNotice(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
): string {
  if (report.isPro) return "";
  return `\n${strings.monthly.proOnly}\n`;
}

/** Render monthly report as HTML email. */
function renderHtmlMonthlyReport(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
  options: EmailRenderOptions,
): string {
  const monthLabel = formatMonthLabel(report.month, report.language);
  const title = report.isPro
    ? strings.monthly.title(report.profileName, monthLabel)
    : strings.monthly.shortTitle(report.profileName, monthLabel);

  let html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 640px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 16px; color: #1a1a1a;">${escapeHtml(title)}</h1>
  `;

  html += renderHtmlIntro(report, strings);
  html += renderHtmlTopEvents(report, strings);
  html += renderHtmlTargetSummaries(report, strings);
  html += renderHtmlPriceChanges(report, strings);
  html += renderHtmlHiring(report, strings);
  html += renderHtmlDecisions(report, strings);
  html += renderHtmlDrifted(report, strings);
  html += renderHtmlSourcesChecked(report, strings);
  html += renderHtmlProNotice(report, strings);

  html += renderHtmlFooter(options, report.language);
  return html;
}

/** Render monthly report as plain text email. */
function renderTextMonthlyReport(
  report: MonthlyReportEmailData,
  strings: ReturnType<typeof stringsFor>,
  options: EmailRenderOptions,
): string {
  const monthLabel = formatMonthLabel(report.month, report.language);
  const title = report.isPro
    ? strings.monthly.title(report.profileName, monthLabel)
    : strings.monthly.shortTitle(report.profileName, monthLabel);

  let text = `${title}\n${"=".repeat(title.length)}\n\n`;

  text += renderTextIntro(report, strings);
  text += renderTextTopEvents(report, strings);
  text += renderTextTargetSummaries(report, strings);
  text += renderTextPriceChanges(report, strings);
  text += renderTextHiring(report, strings);
  text += renderTextDecisions(report, strings);
  text += renderTextDrifted(report, strings);
  text += renderTextSourcesChecked(report, strings);
  text += renderTextProNotice(report, strings);

  text += renderTextFooter(options, report.language);
  return text;
}

/** Render monthly report subject line. */
function renderMonthlySubject(report: MonthlyReportEmailData): string {
  const monthLabel = formatMonthLabel(report.month, report.language);
  return `Mifluent: Monthly report — ${report.profileName} — ${monthLabel}`;
}

export function renderEmailDigest(digest: DigestView, options: EmailRenderOptions): RenderedEmail {
  const strings = stringsFor(digest.language);
  const period = formatPeriod(digest.periodStart, digest.periodEnd, digest.language, "UTC");
  const subject = renderSubject(digest);

  // HTML version
  let html = renderHtmlHeader(digest, strings);

  for (const notice of digest.notices) {
    html += renderHtmlNotice(notice, strings);
  }

  html +=
    digest.cards.length === 0
      ? renderHtmlEmptyDigest(digest, strings, period)
      : renderHtmlCards(digest, strings, options);

  html += renderHtmlFooter(options, digest.language);

  // Text version
  let text = renderTextHeader(digest, strings);

  for (const notice of digest.notices) {
    text += renderTextNotice(notice, strings);
  }

  text +=
    digest.cards.length === 0
      ? renderTextEmptyDigest(digest, strings, period)
      : renderTextCards(digest, strings, options);

  text += renderTextFooter(options, digest.language);

  return { subject, html, text };
}

function renderHtmlCards(
  digest: DigestView,
  strings: Strings,
  options: EmailRenderOptions,
): string {
  return digest.cards
    .map((card, index) => {
      const heading = startsMarketSection(digest.cards, index)
        ? `<h2 style="font-size:18px;margin:32px 0 8px">${escapeHtml(strings.marketSection)}</h2>`
        : "";
      return heading + renderHtmlCard(card, strings, options, digest.language);
    })
    .join("");
}

function renderTextCards(
  digest: DigestView,
  strings: Strings,
  options: EmailRenderOptions,
): string {
  return digest.cards
    .map((card, index) => {
      const heading = startsMarketSection(digest.cards, index)
        ? `\n${strings.marketSection.toUpperCase()}\n\n`
        : "";
      return heading + renderTextCard(card, strings, options, digest.language);
    })
    .join("");
}

/** True for the first card of the market section: the place for its heading. */
function startsMarketSection(cards: DigestView["cards"], index: number): boolean {
  return cards[index]?.section === "market" && cards[index - 1]?.section !== "market";
}

export function renderMonthlyReportEmail(
  report: MonthlyReportEmailData,
  options: EmailRenderOptions,
): RenderedEmail {
  const strings = stringsFor(report.language);
  const subject = renderMonthlySubject(report);
  const html = renderHtmlMonthlyReport(report, strings, options);
  const text = renderTextMonthlyReport(report, strings, options);
  return { subject, html, text };
}
