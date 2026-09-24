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
import { MAX_MESSAGE_LENGTH, type OutgoingMessage } from "./telegram-api.js";

export interface RenderOptions {
  /** Where "and N more" points for a folded card. */
  readonly appUrl: string;
  /** The reader's zone, for the dates in the header. */
  readonly timezone: string;
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
    lines.push(
      "",
      escapeHtml(strings.emptyDigest(period, digest.sourcesChecked, digest.itemsConsidered)),
    );
    if (digest.nearMisses.length > 0) {
      lines.push("", escapeHtml(strings.closest));
      for (const miss of digest.nearMisses) {
        const title = link(miss.url, miss.title === "" ? "—" : miss.title);
        lines.push(
          `• ${title} — ${escapeHtml(strings.rejectedBecause)} ${escapeHtml(strings.rejectionReason(miss.reason))}`,
        );
      }
    }
  }

  return { text: fitToLimit(lines) };
}

function renderCard(
  card: DigestCardView,
  strings: Strings,
  options: RenderOptions,
): OutgoingMessage {
  const headline =
    card.kind === "group"
      ? strings.groupHeadline(card.headline, card.blocks.length + card.moreCount)
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
      { text: strings.buttons.notFollowing, callbackData: `not_following_target:${card.id}` },
      { text: strings.buttons.notImportant, callbackData: `not_important:${card.id}` },
      { text: strings.buttons.save, callbackData: `saved:${card.id}` },
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
