/**
 * Building a digest and writing it down.
 *
 * A digest row is written even when nothing passed the filter: an empty week
 * is reported as such — how many sources were read, how much material, and
 * what came closest — because silence reads as a broken product.
 *
 * Idempotent. The window end is the top of the hour and the unique index on
 * (profile, window, channel) holds, so a tick that runs twice, or a job that is
 * retried, finds the digest it already built instead of building another.
 */

import { AppError, toSafeLink, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import type { DigestNotice } from "@mifluent/db/schema";
import { findTenantPlan } from "@mifluent/domain";
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { assembleCards, type CardDraft, type EventForCard } from "./cards.js";
import {
  type DeliveryDefaults,
  type ResolvedDelivery,
  resolveDelivery,
  windowEndFor,
} from "./schedule.js";

export interface BuildContext {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly profileId: string;
  readonly defaults: Omit<DeliveryDefaults, "isDailyAllowed">;
  /** Whether processing is paused by the daily cost cap; the digest says so. */
  readonly isCostCapReached: boolean;
}

export interface BuiltDigest {
  readonly digestId: string;
  readonly isNew: boolean;
  readonly channel: "telegram" | "web_only";
  readonly cardCount: number;
}

type Window = { readonly start: Date; readonly end: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/** First run: a week back, and a month if the week was empty (TASK-009). */
const FIRST_RUN_DAYS = 7;
const FIRST_RUN_FALLBACK_DAYS = 30;

/** A digest never reaches further back than this, however long the pause was. */
const MAX_WINDOW_DAYS = 30;

/** A target this far below its usual volume gets a "quieter than usual" line. */
const QUIET_BASELINE_WINDOWS = 4;
const QUIET_MINIMUM_AVERAGE = 3;

const NEAR_MISSES_SHOWN = 3;

export async function resolveProfileDelivery(context: BuildContext): Promise<ResolvedDelivery> {
  const [profile] = await context.db
    .select({ delivery: schema.watchProfiles.delivery })
    .from(schema.watchProfiles)
    .where(
      scopedAlive(
        schema.watchProfiles,
        context.tenantId,
        eq(schema.watchProfiles.id, context.profileId),
      ),
    )
    .limit(1);

  const { limits } = await findTenantPlan(context.db, context.tenantId);
  return resolveDelivery(profile?.delivery ?? {}, {
    ...context.defaults,
    isDailyAllowed: limits.dailyDigest,
  });
}

/** The regular digest due now: weekly or daily, per the profile's settings. */
export async function buildPeriodDigest(context: BuildContext, now: Date): Promise<BuiltDigest> {
  const delivery = await resolveProfileDelivery(context);
  // The window ends now, so everything recorded up to this moment is in it.
  // (Ending it at the top of the hour dropped whatever the first run had
  // just produced — the whole first digest.)
  const end = now;
  const previousEnd = await findPreviousRegularEnd(context);
  const isFirstRun = previousEnd === null;

  // Already built this hour — a second tick, or a retried job.
  if (previousEnd !== null && previousEnd.getTime() >= windowEndFor(now).getTime()) {
    const existingId = await findDigestEndingAt(context, previousEnd);
    if (existingId !== undefined) {
      const channel = delivery.telegramChatId === null ? "web_only" : "telegram";
      return { digestId: existingId, isNew: false, channel, cardCount: 0 };
    }
  }

  let window = planWindow({ previousEnd, end, cadence: delivery.cadence, isWidened: false });
  let events = await loadEventsForCards(context, { window });
  if (isFirstRun && events.length === 0) {
    window = planWindow({ previousEnd, end, cadence: delivery.cadence, isWidened: true });
    events = await loadEventsForCards(context, { window });
  }

  const notices = await collectNotices(context, window, isFirstRun);
  return writeDigest(context, {
    window,
    delivery,
    cards: assembleCards(events, end),
    notices,
  });
}

/**
 * An urgent event goes out on its own, immediately. Its window is the moment
 * it was recorded, which is what makes it unique among the profile's digests.
 */
export async function buildUrgentDigest(
  context: BuildContext,
  eventId: string,
): Promise<BuiltDigest | null> {
  const [event] = await context.db
    .select({ createdAt: schema.events.createdAt, isUrgent: schema.events.isUrgent })
    .from(schema.events)
    .where(scoped(schema.events, context.tenantId, eq(schema.events.id, eventId)))
    .limit(1);

  if (event === undefined || !event.isUrgent) return null;

  const events = await loadEventsForCards(context, { eventIds: [eventId] });
  if (events.length === 0) return null;

  const delivery = await resolveProfileDelivery(context);
  return writeDigest(context, {
    window: { start: event.createdAt, end: event.createdAt },
    delivery,
    cards: assembleCards(events, new Date()),
    notices: [],
  });
}

export interface WindowPlan {
  readonly previousEnd: Date | null;
  readonly end: Date;
  readonly cadence: ResolvedDelivery["cadence"];
  /** First run found nothing in a week; look back a month instead. */
  readonly isWidened: boolean;
}

/**
 * The window a regular digest covers: from where the last one ended, or — on
 * the first run — a week back, widened to a month if the week was empty.
 * Never more than a month, however long the instance was stopped.
 */
export function planWindow(plan: WindowPlan): Window {
  const { previousEnd, end } = plan;
  const floor = new Date(end.getTime() - daysMs(MAX_WINDOW_DAYS));

  if (previousEnd !== null) {
    return { start: maxDate(previousEnd, floor), end };
  }

  const days = plan.isWidened ? FIRST_RUN_FALLBACK_DAYS : FIRST_RUN_DAYS;
  return { start: maxDate(new Date(end.getTime() - daysMs(days)), floor), end };
}

interface DigestDraft {
  readonly window: Window;
  readonly delivery: ResolvedDelivery;
  readonly cards: readonly CardDraft[];
  readonly notices: readonly DigestNotice[];
}

async function writeDigest(context: BuildContext, draft: DigestDraft): Promise<BuiltDigest> {
  const { db, tenantId, profileId } = context;
  const channel = draft.delivery.telegramChatId === null ? "web_only" : "telegram";

  const existing = await findExistingDigest(context, draft.window, channel);
  if (existing !== undefined) {
    return { digestId: existing, isNew: false, channel, cardCount: draft.cards.length };
  }

  const versionId = await currentVersionId(context);
  const stats = await collectStats(context, draft.window);
  const digestId = uuidv7();
  const now = new Date();

  await db.transaction(async (transaction) => {
    await transaction.insert(schema.digests).values({
      id: digestId,
      tenantId,
      profileId,
      profileVersionId: versionId,
      periodStart: draft.window.start,
      periodEnd: draft.window.end,
      channel,
      // The web shows whatever was built last; there is nothing to send.
      status: channel === "web_only" ? "delivered" : "pending",
      deliveredAt: channel === "web_only" ? now : null,
      sourcesChecked: stats.sourcesChecked,
      itemsConsidered: stats.itemsConsidered,
      nearMisses: stats.nearMisses,
      notices: [...draft.notices],
    });

    for (const [position, card] of draft.cards.entries()) {
      const cardId = uuidv7();
      await transaction.insert(schema.digestCards).values({
        id: cardId,
        tenantId,
        digestId,
        eventId: card.eventId,
        position,
        kind: card.kind,
        headline: card.headline,
        sourceUrl: card.sourceUrl,
        ageDays: card.ageDays,
        moreCount: card.moreCount,
      });

      if (card.blocks.length > 0) {
        await transaction.insert(schema.cardBlocks).values(
          card.blocks.map((block, blockPosition) => ({
            id: uuidv7(),
            tenantId,
            cardId,
            kind: block.kind,
            position: blockPosition,
            content: block.content,
            quote: block.quote,
            sourceUrl: block.sourceUrl,
          })),
        );
      }
    }
  });

  return { digestId, isNew: true, channel, cardCount: draft.cards.length };
}

interface EventSelection {
  readonly window?: Window;
  readonly eventIds?: readonly string[];
}

/**
 * Events with at least one verified fact, about targets that are not paused.
 * An event without facts either failed extraction or has not been written up
 * yet; neither belongs in front of a reader.
 */
async function loadEventsForCards(
  context: BuildContext,
  selection: EventSelection,
): Promise<EventForCard[]> {
  const { db, tenantId, profileId } = context;

  const rows = await db
    .select({
      id: schema.events.id,
      summary: schema.events.summary,
      implication: schema.events.implication,
      interpretation: schema.events.interpretation,
      isUrgent: schema.events.isUrgent,
      relevanceScore: schema.events.relevanceScore,
      occurredAt: schema.events.occurredAt,
      createdAt: schema.events.createdAt,
      targetId: schema.events.targetId,
      targetName: schema.watchTargets.name,
      sourceUrl: schema.rawItems.url,
    })
    .from(schema.events)
    .innerJoin(schema.rawItems, eq(schema.rawItems.id, schema.events.rawItemId))
    .leftJoin(schema.watchTargets, eq(schema.watchTargets.id, schema.events.targetId))
    .where(
      scoped(
        schema.events,
        tenantId,
        eq(schema.events.profileId, profileId),
        selection.window === undefined
          ? undefined
          : gte(schema.events.createdAt, selection.window.start),
        selection.window === undefined
          ? undefined
          : lt(schema.events.createdAt, selection.window.end),
        selection.eventIds === undefined
          ? undefined
          : inArray(schema.events.id, [...selection.eventIds]),
        isNull(schema.watchTargets.pausedAt),
        sql`EXISTS (SELECT 1 FROM ${schema.facts} WHERE ${schema.facts.eventId} = ${schema.events.id})`,
      ),
    );

  if (rows.length === 0) return [];

  const facts = await db
    .select({
      eventId: schema.facts.eventId,
      statement: schema.facts.statement,
      quote: schema.facts.quote,
    })
    .from(schema.facts)
    .where(
      scoped(
        schema.facts,
        tenantId,
        inArray(
          schema.facts.eventId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(schema.facts.createdAt);

  return rows.map((row) => ({
    ...row,
    facts: facts.filter((fact) => fact.eventId === row.id),
  }));
}

interface DigestStats {
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
  readonly nearMisses: { title: string; url: string | null; reason: string }[];
}

async function collectStats(context: BuildContext, window: Window): Promise<DigestStats> {
  const { db, tenantId, profileId } = context;

  const [sources] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.sources)
    .where(
      scopedAlive(
        schema.sources,
        tenantId,
        eq(schema.sources.profileId, profileId),
        gte(schema.sources.lastPolledAt, window.start),
      ),
    );

  const [items] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.rawItems)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.rawItems.sourceId))
    .where(
      scoped(
        schema.rawItems,
        tenantId,
        eq(schema.sources.profileId, profileId),
        gte(schema.rawItems.fetchedAt, window.start),
        lt(schema.rawItems.fetchedAt, window.end),
      ),
    );

  const misses = await db
    .select({
      title: schema.rawItems.title,
      url: schema.rawItems.url,
      reason: schema.rejections.reason,
      detail: schema.rejections.detail,
    })
    .from(schema.rejections)
    .innerJoin(schema.rawItems, eq(schema.rawItems.id, schema.rejections.rawItemId))
    .where(
      scoped(
        schema.rejections,
        tenantId,
        eq(schema.rejections.profileId, profileId),
        // A stopword is the reader's own "never show me this"; it is not a near miss.
        ne(schema.rejections.reason, "stopword"),
        gte(schema.rejections.occurredAt, window.start),
        lt(schema.rejections.occurredAt, window.end),
      ),
    )
    .orderBy(desc(schema.rejections.score))
    .limit(NEAR_MISSES_SHOWN);

  return {
    sourcesChecked: sources?.total ?? 0,
    itemsConsidered: items?.total ?? 0,
    nearMisses: misses.map((miss) => ({
      title: miss.title ?? "",
      url: toSafeLink(miss.url),
      // The model's own sentence when there is one; otherwise the code, which
      // the renderer turns into words.
      reason: miss.detail ?? miss.reason,
    })),
  };
}

async function collectNotices(
  context: BuildContext,
  window: Window,
  isFirstRun: boolean,
): Promise<DigestNotice[]> {
  const notices: DigestNotice[] = [];

  if (context.isCostCapReached) {
    notices.push({ code: "cost_cap_reached" });
  }

  if (isFirstRun && (await hasPageOrBoardSources(context))) {
    notices.push({ code: "baseline_recorded" });
  }

  for (const targetName of await findQuietTargets(context, window)) {
    notices.push({ code: "target_quiet", targetName });
  }

  return notices;
}

/**
 * Targets that went silent: nothing this window, against an average above
 * three per window over the four before it. A competitor who normally posts
 * weekly and has said nothing for a month is itself news.
 */
async function findQuietTargets(context: BuildContext, window: Window): Promise<string[]> {
  const { db, tenantId, profileId } = context;
  const length = window.end.getTime() - window.start.getTime();
  if (length <= 0) return [];

  const baselineStart = new Date(window.start.getTime() - length * QUIET_BASELINE_WINDOWS);

  const rows = await db
    .select({
      name: schema.watchTargets.name,
      // A Date inside a raw fragment is not mapped by the column type, so it
      // goes as an ISO string with an explicit cast.
      current: sql<number>`count(*) FILTER (WHERE ${schema.rawItems.fetchedAt} >= ${window.start.toISOString()}::timestamptz)::int`,
      baseline: sql<number>`count(*) FILTER (WHERE ${schema.rawItems.fetchedAt} < ${window.start.toISOString()}::timestamptz)::int`,
    })
    .from(schema.watchTargets)
    .innerJoin(schema.sources, eq(schema.sources.targetId, schema.watchTargets.id))
    .innerJoin(schema.rawItems, eq(schema.rawItems.sourceId, schema.sources.id))
    .where(
      scopedAlive(
        schema.watchTargets,
        tenantId,
        eq(schema.watchTargets.profileId, profileId),
        isNull(schema.watchTargets.pausedAt),
        gte(schema.rawItems.fetchedAt, baselineStart),
        lt(schema.rawItems.fetchedAt, window.end),
      ),
    )
    .groupBy(schema.watchTargets.id, schema.watchTargets.name);

  return rows
    .filter(
      (row) => row.current === 0 && row.baseline / QUIET_BASELINE_WINDOWS > QUIET_MINIMUM_AVERAGE,
    )
    .map((row) => row.name);
}

async function hasPageOrBoardSources(context: BuildContext): Promise<boolean> {
  const [row] = await context.db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.sources)
    .where(
      scopedAlive(
        schema.sources,
        context.tenantId,
        eq(schema.sources.profileId, context.profileId),
        inArray(schema.sources.kind, ["diff", "json"]),
      ),
    );
  return (row?.total ?? 0) > 0;
}

/** The end of the last regular digest. Urgent ones have start = end and do not count. */
async function findPreviousRegularEnd(context: BuildContext): Promise<Date | null> {
  const [row] = await context.db
    .select({ end: schema.digests.periodEnd })
    .from(schema.digests)
    .where(
      scoped(
        schema.digests,
        context.tenantId,
        eq(schema.digests.profileId, context.profileId),
        ne(schema.digests.periodStart, schema.digests.periodEnd),
      ),
    )
    .orderBy(desc(schema.digests.periodEnd))
    .limit(1);

  return row?.end ?? null;
}

async function findDigestEndingAt(context: BuildContext, end: Date): Promise<string | undefined> {
  const [row] = await context.db
    .select({ id: schema.digests.id })
    .from(schema.digests)
    .where(
      scoped(
        schema.digests,
        context.tenantId,
        eq(schema.digests.profileId, context.profileId),
        eq(schema.digests.periodEnd, end),
        ne(schema.digests.periodStart, schema.digests.periodEnd),
      ),
    )
    .limit(1);
  return row?.id;
}

async function findExistingDigest(
  context: BuildContext,
  window: Window,
  channel: "telegram" | "web_only",
): Promise<string | undefined> {
  const [row] = await context.db
    .select({ id: schema.digests.id })
    .from(schema.digests)
    .where(
      scoped(
        schema.digests,
        context.tenantId,
        and(
          eq(schema.digests.profileId, context.profileId),
          eq(schema.digests.periodStart, window.start),
          eq(schema.digests.periodEnd, window.end),
          eq(schema.digests.channel, channel),
        ),
      ),
    )
    .limit(1);
  return row?.id;
}

async function currentVersionId(context: BuildContext): Promise<string> {
  const [row] = await context.db
    .select({ versionId: schema.watchProfiles.currentVersionId })
    .from(schema.watchProfiles)
    .where(
      scoped(
        schema.watchProfiles,
        context.tenantId,
        eq(schema.watchProfiles.id, context.profileId),
      ),
    )
    .limit(1);

  if (row?.versionId === null || row?.versionId === undefined) {
    // A profile without a version has never been saved with anything to
    // select on; the scheduler does not build for those.
    throw new AppError("not_found", "This profile has nothing to build a digest from yet.", {
      profileId: context.profileId,
    });
  }
  return row.versionId;
}

function daysMs(days: number): number {
  return days * DAY_MS;
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}
