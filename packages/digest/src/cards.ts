/**
 * Turning a window's events into digest cards. Pure: no database, no clock.
 *
 * A card is separately attributed blocks, never one paragraph — a fact with
 * its quote and link, "why this touches you", and the model's own reading
 * labelled as such. The reader has to be able to see which sentence is a
 * checked fact and which is a machine's opinion.
 *
 * Deterministic on purpose (TASK-009): no model call here. The same events
 * always make the same digest.
 */

import { AppError, toSafeLink } from "@mifluent/core";

export interface EventForCard {
  readonly id: string;
  readonly summary: string;
  readonly implication: string | null;
  readonly interpretation: string | null;
  readonly isUrgent: boolean;
  readonly relevanceScore: number;
  readonly occurredAt: Date | null;
  readonly createdAt: Date;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly targetKind: "competitor" | "platform" | "condition" | "self" | null;
  readonly sourceUrl: string | null;
  readonly facts: readonly { readonly statement: string; readonly quote: string }[];
  /** price, plan, policy, market_rule, market_news, platform, news… */
  readonly kind: string | null;
  /** Set when the material came from a shared source pack, not the profile's own sources. */
  readonly packKey: string | null;
}

export type BlockKind = "fact" | "implication" | "model_interpretation";

export interface BlockDraft {
  readonly kind: BlockKind;
  readonly content: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

export interface CardDraft {
  readonly kind: "event" | "group";
  readonly eventId: string;
  readonly headline: string;
  readonly sourceUrl: string | null;
  readonly ageDays: number;
  readonly moreCount: number;
  readonly isUrgent: boolean;
  readonly blocks: readonly BlockDraft[];
  readonly targetKind: "competitor" | "platform" | "condition" | "self" | null;
  /** `market`: the "your market & rules" section at the end of the digest. */
  readonly section: "main" | "market";
}

/** Past this many events a weekly digest stops being read; related ones are folded. */
export const GROUPING_THRESHOLD = 7;

/**
 * Cards in the "your market & rules" section. Laws and platform rules are
 * context, not the reason someone opened the digest; more than this crowds out
 * their competitors.
 */
export const MARKET_SECTION_LIMIT = 6;

/** Rules first: a law or a platform's binding rule costs money if missed. */
const MARKET_RANK: Readonly<Record<string, number>> = {
  market_rule: 0,
  policy: 0,
  price: 1,
  plan: 1,
  platform: 2,
  market_news: 3,
};

/** How many facts a folded card shows before "N more". */
const GROUP_FACTS_SHOWN = 3;

/**
 * Text fragments match whole words in Chromium, so the fragment is cut at a
 * word boundary no later than this.
 */
const FRAGMENT_MAX_LENGTH = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export function assembleCards(events: readonly EventForCard[], periodEnd: Date): CardDraft[] {
  const own = events.filter((event) => event.packKey === null);
  const market = events.filter((event) => event.packKey !== null);
  return [...mainCards(own, periodEnd), ...marketCards(market, periodEnd)];
}

function mainCards(events: readonly EventForCard[], periodEnd: Date): CardDraft[] {
  const ordered = [...events].sort(byImportance);

  if (ordered.length <= GROUPING_THRESHOLD) {
    return ordered.map((event) => eventCard(event, periodEnd));
  }

  return foldByTarget(ordered, periodEnd);
}

/**
 * The market section: never folded (each rule is its own thing), ordered by
 * kind and then by freshness, cut at the section limit. An urgent rule is not
 * here — it already went out on its own the day it was found.
 */
function marketCards(events: readonly EventForCard[], periodEnd: Date): CardDraft[] {
  return [...events]
    .sort((left, right) => {
      const rank = marketRank(left) - marketRank(right);
      if (rank !== 0) return rank;
      return happenedAt(right) - happenedAt(left);
    })
    .slice(0, MARKET_SECTION_LIMIT)
    .map((event) => ({ ...eventCard(event, periodEnd), section: "market" as const }));
}

function marketRank(event: EventForCard): number {
  return MARKET_RANK[event.kind ?? ""] ?? 4;
}

function happenedAt(event: EventForCard): number {
  return (event.occurredAt ?? event.createdAt).getTime();
}

/**
 * Walk in importance order so a group sits where its most important event
 * would have been, and an urgent event is never pushed down by folding.
 */
function foldByTarget(ordered: readonly EventForCard[], periodEnd: Date): CardDraft[] {
  const byTarget = new Map<string, EventForCard[]>();
  for (const event of ordered) {
    if (event.targetId === null || event.isUrgent) continue;
    byTarget.set(event.targetId, [...(byTarget.get(event.targetId) ?? []), event]);
  }

  const cards: CardDraft[] = [];
  const emitted = new Set<string>();

  for (const event of ordered) {
    if (emitted.has(event.id)) continue;

    const members = foldableWith(event, byTarget).filter((member) => !emitted.has(member.id));
    const card = members.length < 2 ? eventCard(event, periodEnd) : groupCard(members, periodEnd);
    cards.push(card);
    for (const member of members.length < 2 ? [event] : members) emitted.add(member.id);
  }

  return cards;
}

function foldableWith(
  event: EventForCard,
  byTarget: ReadonlyMap<string, readonly EventForCard[]>,
): readonly EventForCard[] {
  if (event.isUrgent || event.targetId === null) return [];
  return byTarget.get(event.targetId) ?? [];
}

/** A link to the exact passage: the page, plus a text fragment of the quote. */
export function linkToQuote(sourceUrl: string | null, quote: string): string | null {
  const safe = toSafeLink(sourceUrl);
  if (safe === null) return null;

  const fragment = cutAtWord(quote.replace(/\s+/g, " ").trim(), FRAGMENT_MAX_LENGTH);
  if (fragment === "") return safe;

  // `-` and `,` delimit prefix and suffix in the text directive, so they are
  // escaped even though encodeURIComponent leaves `-` alone.
  const encoded = encodeURIComponent(fragment).replace(/-/g, "%2D");
  return `${safe}#:~:text=${encoded}`;
}

export function ageInDays(event: Pick<EventForCard, "occurredAt" | "createdAt">, at: Date): number {
  const happened = event.occurredAt ?? event.createdAt;
  return Math.max(0, Math.floor((at.getTime() - happened.getTime()) / DAY_MS));
}

function eventCard(event: EventForCard, periodEnd: Date): CardDraft {
  const blocks: BlockDraft[] = event.facts.map((fact) => factBlock(fact, event.sourceUrl));

  if (event.implication !== null && event.implication.trim() !== "") {
    blocks.push({ kind: "implication", content: event.implication, quote: null, sourceUrl: null });
  }
  if (event.interpretation !== null && event.interpretation.trim() !== "") {
    blocks.push({
      kind: "model_interpretation",
      content: event.interpretation,
      quote: null,
      sourceUrl: null,
    });
  }

  return {
    kind: "event",
    eventId: event.id,
    headline: event.summary,
    sourceUrl: toSafeLink(event.sourceUrl),
    ageDays: ageInDays(event, periodEnd),
    moreCount: 0,
    isUrgent: event.isUrgent,
    blocks,
    targetKind: event.targetKind,
    section: "main",
  };
}

function groupCard(members: readonly EventForCard[], periodEnd: Date): CardDraft {
  const [first] = members;
  if (first === undefined) {
    throw new AppError("internal_error", "Something went wrong on our side.", {
      reason: "a group card needs at least one event",
    });
  }

  const facts = members.flatMap((member) =>
    member.facts.slice(0, 1).map((fact) => factBlock(fact, member.sourceUrl)),
  );

  return {
    kind: "group",
    eventId: first.id,
    // The renderer adds "N changes" in the reader's language.
    headline: first.targetName ?? first.summary,
    sourceUrl: toSafeLink(first.sourceUrl),
    ageDays: Math.min(...members.map((member) => ageInDays(member, periodEnd))),
    moreCount: Math.max(0, members.length - GROUP_FACTS_SHOWN),
    isUrgent: false,
    blocks: facts.slice(0, GROUP_FACTS_SHOWN),
    targetKind: first.targetKind,
    section: "main",
  };
}

function factBlock(fact: EventForCard["facts"][number], sourceUrl: string | null): BlockDraft {
  return {
    kind: "fact",
    content: fact.statement,
    quote: fact.quote,
    sourceUrl: linkToQuote(sourceUrl, fact.quote),
  };
}

function byImportance(left: EventForCard, right: EventForCard): number {
  if (left.isUrgent !== right.isUrgent) return left.isUrgent ? -1 : 1;
  return right.relevanceScore - left.relevanceScore;
}

function cutAtWord(text: string, maximum: number): string {
  if (text.length <= maximum) return text;
  const cut = text.slice(0, maximum);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}
