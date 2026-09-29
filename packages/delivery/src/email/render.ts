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
import { formatPeriod, type Language, stringsFor } from "../strings.js";

export interface EmailRenderOptions {
  readonly appUrl: string;
  readonly timezone: string;
  readonly actionBaseUrl: string;
  readonly unsubscribeUrl: string;
  readonly feedbackEmail: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
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
  const actions = ["not_following_target", "not_important", "saved", "influenced"] as const;
  for (const action of actions) {
    const token = `${card.id}|${action}|${Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60}`; // placeholder, real token generated in deliver
    const actionUrl = `${options.actionBaseUrl}/${token}`;
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
  const actions = ["not_following_target", "not_important", "saved", "influenced"] as const;
  for (const action of actions) {
    const token = `${card.id}|${action}|${Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60}`; // placeholder
    const actionUrl = `${options.actionBaseUrl}/${token}`;
    text += `  ${actionLabel(action, language)}: ${actionUrl}\n`;
  }

  return `${text}\n`;
}

function renderTextFooter(options: EmailRenderOptions, _language: Language): string {
  return `
--------------------------------
Summaries are AI-generated from the linked sources.
Unsubscribe: ${options.unsubscribeUrl}
Reply to this email — it goes straight to the founder.
`;
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

  if (digest.cards.length === 0) {
    html += renderHtmlEmptyDigest(digest, strings, period);
  } else {
    for (const card of digest.cards) {
      html += renderHtmlCard(card, strings, options, digest.language);
    }
  }

  html += renderHtmlFooter(options, digest.language);

  // Text version
  let text = renderTextHeader(digest, strings);

  for (const notice of digest.notices) {
    text += renderTextNotice(notice, strings);
  }

  if (digest.cards.length === 0) {
    text += renderTextEmptyDigest(digest, strings, period);
  } else {
    for (const card of digest.cards) {
      text += renderTextCard(card, strings, options, digest.language);
    }
  }

  text += renderTextFooter(options, digest.language);

  return { subject, html, text };
}
