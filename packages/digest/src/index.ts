/**
 * Digest assembly.
 *
 * Builds weekly/urgent digests from events. Deterministic, no model calls.
 */

import { uuidv7 } from "@mifluent/core";
import type { Database } from "@mifluent/db";
import { schema } from "@mifluent/db";
import { desc, eq } from "drizzle-orm";

/**
 * Delivery settings for a watch profile.
 */
export interface DeliverySettings {
  cadence: "weekly" | "daily";
  weekday: number; // 1..7 (Monday=1)
  hour: number; // 0..23
  timezone: string; // IANA timezone
}

/**
 * Options for building a digest.
 */
export interface BuildDigestOptions {
  readonly db: Database;
  readonly profileId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly isUrgent?: boolean;
}

/**
 * Result of building a digest.
 */
export interface BuildDigestResult {
  readonly digestId: string;
  readonly cards: ReadonlyArray<DigestCard>;
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
  readonly nearMisses: ReadonlyArray<NearMiss>;
}

export interface DigestCard {
  readonly id: string;
  readonly kind: "event" | "group" | "silence";
  readonly headline: string;
  readonly sourceUrl: string | null;
  readonly ageDays: number;
  readonly blocks: CardBlock[];
}

export type CardBlock =
  | {
      readonly type: "fact";
      readonly statement: string;
      readonly quote: string;
      readonly textFragmentUrl: string;
    }
  | { readonly type: "implication"; readonly text: string }
  | { readonly type: "interpretation"; readonly text: string };

export interface NearMiss {
  readonly rawItemId: string;
  readonly score: number;
  readonly reason: string;
}

/**
 * Build a digest for a profile over a time window.
 */
export async function buildDigest(options: BuildDigestOptions): Promise<BuildDigestResult> {
  const { db, profileId, periodStart, periodEnd, isUrgent = false } = options;

  // Fetch events for the profile in the time window
  const events = await fetchEventsForDigest(db, profileId, periodStart, periodEnd);

  // Separate urgent and non-urgent
  const urgentEvents = events.filter((e) => e.isUrgent);
  const regularEvents = events.filter((e) => !e.isUrgent);

  // Sort: urgent first, then by relevance score desc
  const sortedEvents = [
    ...urgentEvents,
    ...regularEvents.sort((a, b) => b.relevanceScore - a.relevanceScore),
  ];

  // Build cards
  const cards: DigestCard[] = [];

  for (const event of sortedEvents) {
    // Get the primary raw item for this event
    const [primaryItem] = await db
      .select()
      .from(schema.rawItems)
      .where(eq(schema.rawItems.id, event.rawItemId))
      .limit(1);

    if (!primaryItem) continue;

    // Get facts for this event
    const facts = await db.select().from(schema.facts).where(eq(schema.facts.eventId, event.id));

    const card = await buildCard(event, primaryItem, facts);
    cards.push(card);
  }

  // Group events by target if > 7 events
  const groupedCards = groupCardsByTarget(cards);

  // Get stats
  const stats = await getDigestStats(db, profileId, periodStart, periodEnd);

  // Check for silent target
  if (!isUrgent && cards.length === 0) {
    const silentCard = await checkSilentTarget(db, profileId, periodStart, periodEnd);
    if (silentCard) {
      return buildDigestResult(uuidv7(), [silentCard], 0, 0, []);
    }
  }

  const digestId = uuidv7();

  return buildDigestResult(
    digestId,
    groupedCards,
    stats.sourcesChecked,
    stats.itemsConsidered,
    stats.nearMisses,
  );
}

/**
 * Fetch events for a profile within a time window.
 */
async function fetchEventsForDigest(
  db: Database,
  profileId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const { schema } = await import("@mifluent/db");
  const { eq, and, gte, lte, desc } = await import("drizzle-orm");

  return db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.profileId, profileId),
        gte(schema.events.createdAt, periodStart),
        lte(schema.events.createdAt, periodEnd),
      ),
    )
    .orderBy(desc(schema.events.createdAt));
}

/**
 * Build a single digest card from an event.
 */
async function buildCard(
  event: typeof schema.events.$inferSelect,
  primaryItem: typeof schema.rawItems.$inferSelect,
  facts: (typeof schema.facts.$inferSelect)[],
): Promise<DigestCard> {
  const occurredAt = event.occurredAt ?? new Date();
  const ageDays = Math.floor((Date.now() - new Date(occurredAt).getTime()) / (1000 * 60 * 60 * 24));

  const blocks: CardBlock[] = [];

  // Fact blocks
  for (const fact of facts) {
    if (fact.quote && fact.quoteStartOffset !== null && fact.quoteEndOffset !== null) {
      const textFragment = encodeURIComponent(fact.quote.slice(0, 60));
      blocks.push({
        type: "fact",
        statement: fact.statement,
        quote: fact.quote,
        textFragmentUrl: `#:~:text=${textFragment}`,
      });
    }
  }

  // Implication block
  if (event.implication) {
    blocks.push({ type: "implication", text: event.implication });
  }

  // Interpretation block
  // Note: event.interpretation is not in the schema yet, skipping for now
  // if (event.interpretation) {
  //   blocks.push({ type: "interpretation", text: event.interpretation });
  // }

  return {
    id: uuidv7(),
    kind: "event",
    headline: event.summary,
    sourceUrl: primaryItem.url,
    ageDays: Math.max(0, ageDays),
    blocks,
  };
}

/**
 * Group cards by target if > 7 events.
 */
function groupCardsByTarget(cards: DigestCard[]): DigestCard[] {
  if (cards.length <= 7) return cards;

  const byTarget = new Map<string, DigestCard[]>();
  for (const card of cards) {
    // We don't have targetId on the card, so we don't group for now
    // In a real implementation, we'd track targetId on the card
    const existing = byTarget.get("other") ?? [];
    existing.push(card);
    byTarget.set("other", existing);
  }

  // For now, return as-is
  return cards;
}

/**
 * Get stats for the digest period.
 */
async function getDigestStats(db: Database, profileId: string, periodStart: Date, periodEnd: Date) {
  const { schema } = await import("@mifluent/db");
  const { eq, and, gte, lte, count } = await import("drizzle-orm");

  // Sources checked: active sources for this profile
  const [sourcesChecked] = await db
    .select({ count: count() })
    .from(schema.sources)
    .where(and(eq(schema.sources.profileId, profileId), eq(schema.sources.status, "active")));

  // Items considered: raw items in the period
  const [itemsConsidered] = await db
    .select({ count: count() })
    .from(schema.rawItems)
    .where(
      and(
        eq(schema.rawItems.tenantId, (await getTenantId(db, profileId)) ?? ""),
        gte(schema.rawItems.fetchedAt, periodStart),
        lte(schema.rawItems.fetchedAt, periodEnd),
      ),
    );

  // Near misses: rejections with highest score
  const nearMisses = await db
    .select({
      rawItemId: schema.rejections.rawItemId,
      score: schema.rejections.score,
      reason: schema.rejections.reason,
    })
    .from(schema.rejections)
    .where(
      and(
        eq(schema.rejections.tenantId, (await getTenantId(db, profileId)) ?? ""),
        eq(schema.rejections.profileId, profileId),
        gte(schema.rejections.occurredAt, periodStart),
        lte(schema.rejections.occurredAt, periodEnd),
      ),
    )
    .orderBy(desc(schema.rejections.score))
    .limit(3);

  return {
    sourcesChecked: sourcesChecked?.count ?? 0,
    itemsConsidered: itemsConsidered?.count ?? 0,
    nearMisses: nearMisses.map((n) => ({
      rawItemId: n.rawItemId ?? "",
      score: Number(n.score),
      reason: n.reason ?? "",
    })),
  };
}

async function getTenantId(db: Database, profileId: string): Promise<string | null> {
  const { schema } = await import("@mifluent/db");
  const { eq } = await import("drizzle-orm");

  const [profile] = await db
    .select({ tenantId: schema.watchProfiles.tenantId })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, profileId))
    .limit(1);

  return profile?.tenantId ?? null;
}

/**
 * Check for silent target (target with 0 materials but historically active).
 */
async function checkSilentTarget(
  _db: Database,
  _profileId: string,
  _periodStart: Date,
  _periodEnd: Date,
): Promise<DigestCard | null> {
  // For now, return null - implement later
  return null;
}

function buildDigestResult(
  digestId: string,
  cards: DigestCard[],
  sourcesChecked: number,
  itemsConsidered: number,
  nearMisses: NearMiss[],
): BuildDigestResult {
  return {
    digestId,
    cards,
    sourcesChecked,
    itemsConsidered,
    nearMisses,
  };
}
