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
  const cards = digest.cards.map((card) => renderCard(card, strings, options));
  return [header, ...cards];
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

function renderEmptyDigest(digest: DigestView, strings: Strings, period: string): string {
  const isFirstWeek = Date.now() - digest.profileCreatedAt.getTime() < 7 * 24 * 60 * 60 * 1000;
  if (isFirstWeek && digest.nearMisses.length > 0) {
    const closest = digest.nearMisses.at(0);
    if (!closest) {
      // This should never happen because we checked length > 0
      return escapeHtml(strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered));
    }
    const closestTitle = escapeHtml(closest.title === "" ? "—" : closest.title);
    return escapeHtml(
      strings.emptyDigestFirstWeek(digest.sourcesChecked, digest.itemsConsidered, closestTitle),
    );
  }

  const lines = [strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered)];
  if (digest.nearMisses.length > 0) {
    lines.push("", strings.closest);
    for (const miss of digest.nearMisses) {
      const title = link(miss.url, miss.title === "" ? "—" : miss.title);
      lines.push(
        `• ${title} — ${escapeHtml(strings.rejectedBecause)} ${escapeHtml(strings.rejectionReason(miss.reason))}`,
      );
    }
  }
  return escapeHtml(lines.join("\n"));
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
  const age = card.ageDays === null ? "" : ` <i>(${escapeHtml(strings.age(card.ageDays))})</i>`;

  const lines = [`<b>${escapeHtml(headline)}</b>${age}`];
  for (const block of card.blocks) {
    lines.push("", renderBlock(block, strings));
  }
  if (card.moreCount > 0) {
    lines.push(
      "",
      link(`${options.appUrl.replace(/\/+$/, "")}/today`, strings.more(card.moreCount)),
    );
  }

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
      const source = block.sourceUrl === null ? "" : ` ${link(block.sourceUrl, strings.source)}`;
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
