/**
 * Post drafts from radar events. A draft goes to the owner; nothing is ever
 * published without the owner pressing the button.
 *
 * At most five drafts a day per language, prices, plans and policies first.
 * The rest wait for the Monday round-up draft.
 */

import { uuidv7 } from "@mifluent/core";
import { type Queryable, schema } from "@mifluent/db";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { slugify } from "./files.js";

export const RADAR_POST_KINDS = ["price", "plan", "policy", "feature"] as const;
export const DAILY_DRAFT_LIMIT = 5;

const PRIORITY: Readonly<Record<string, number>> = { price: 0, plan: 0, policy: 1, feature: 2 };

export interface RadarPostDraft {
  readonly postId: string;
  readonly language: "en" | "ru";
  readonly company: string;
  readonly slug: string;
  readonly kind: string;
  readonly summary: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

interface RadarEvent {
  readonly eventId: string;
  readonly language: "en" | "ru";
  readonly company: string;
  readonly kind: string;
  readonly summary: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

/**
 * Turn freshly extracted radar events into drafts (to send now) or queued
 * rows (for the weekly round-up). An event already drafted is left alone.
 */
export async function draftRadarPosts(
  db: Queryable,
  radarTenantId: string,
  eventIds: readonly string[],
  now: Date,
): Promise<RadarPostDraft[]> {
  const events = (await loadRadarEvents(db, radarTenantId, eventIds)).sort(
    (left, right) => (PRIORITY[left.kind] ?? 9) - (PRIORITY[right.kind] ?? 9),
  );
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const drafts: RadarPostDraft[] = [];

  for (const event of events) {
    const [today] = await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.radarPosts)
      .where(
        and(
          eq(schema.radarPosts.language, event.language),
          gte(schema.radarPosts.createdAt, dayStart),
          inArray(schema.radarPosts.status, ["drafted", "published", "skipped"]),
        ),
      );
    const status = (today?.total ?? 0) < DAILY_DRAFT_LIMIT ? "drafted" : "queued";
    const postId = uuidv7();
    const inserted = await db
      .insert(schema.radarPosts)
      .values({
        id: postId,
        eventId: event.eventId,
        language: event.language,
        status,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.radarPosts.id });
    if (inserted.length > 0 && status === "drafted") drafts.push(toDraft(postId, event));
  }
  return drafts;
}

/** A draft by its id, for the owner's buttons. */
export async function findRadarPost(
  db: Queryable,
  radarTenantId: string,
  postId: string,
): Promise<(RadarPostDraft & { readonly status: string }) | undefined> {
  const [post] = await db
    .select({ eventId: schema.radarPosts.eventId, status: schema.radarPosts.status })
    .from(schema.radarPosts)
    .where(eq(schema.radarPosts.id, postId))
    .limit(1);
  if (post === undefined) return undefined;
  const [event] = await loadRadarEvents(db, radarTenantId, [post.eventId]);
  return event === undefined ? undefined : { ...toDraft(postId, event), status: post.status };
}

/** Published or skipped, once: a second press on the same button changes nothing. */
export async function decideRadarPost(
  db: Queryable,
  postId: string,
  status: "published" | "skipped",
  now: Date,
): Promise<boolean> {
  const decided = await db
    .update(schema.radarPosts)
    .set({ status, decidedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.radarPosts.id, postId),
        inArray(schema.radarPosts.status, ["drafted", "queued"]),
      ),
    )
    .returning({ id: schema.radarPosts.id });
  return decided.length > 0;
}

/** What waited over the daily limit during [from, to), for the round-up. */
export async function listQueuedRadarPosts(
  db: Queryable,
  radarTenantId: string,
  language: "en" | "ru",
  from: Date,
  to: Date,
): Promise<RadarPostDraft[]> {
  const rows = await db
    .select({ id: schema.radarPosts.id, eventId: schema.radarPosts.eventId })
    .from(schema.radarPosts)
    .where(
      and(
        eq(schema.radarPosts.language, language),
        eq(schema.radarPosts.status, "queued"),
        gte(schema.radarPosts.createdAt, from),
        lt(schema.radarPosts.createdAt, to),
      ),
    )
    .orderBy(asc(schema.radarPosts.createdAt));
  const events = new Map(
    (
      await loadRadarEvents(
        db,
        radarTenantId,
        rows.map((row) => row.eventId),
      )
    ).map((event) => [event.eventId, event]),
  );
  return rows.flatMap((row) => {
    const event = events.get(row.eventId);
    return event === undefined ? [] : [toDraft(row.id, event)];
  });
}

async function loadRadarEvents(
  db: Queryable,
  radarTenantId: string,
  eventIds: readonly string[],
): Promise<RadarEvent[]> {
  if (eventIds.length === 0) return [];
  const rows = await db
    .select({
      eventId: schema.events.id,
      company: schema.watchTargets.name,
      kind: schema.events.kind,
      summary: schema.events.summary,
      sourceUrl: schema.events.sourceUrl,
      facts: schema.watchProfiles.facts,
    })
    .from(schema.events)
    .innerJoin(schema.watchTargets, eq(schema.watchTargets.id, schema.events.targetId))
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.events.profileId))
    .where(
      and(
        eq(schema.events.tenantId, radarTenantId),
        inArray(schema.events.id, [...eventIds]),
        inArray(schema.events.kind, [...RADAR_POST_KINDS]),
      ),
    );
  const quotes = await db
    .select({ eventId: schema.facts.eventId, quote: schema.facts.quote })
    .from(schema.facts)
    .where(
      and(eq(schema.facts.tenantId, radarTenantId), inArray(schema.facts.eventId, [...eventIds])),
    )
    .orderBy(asc(schema.facts.createdAt));
  const firstQuote = new Map<string, string>();
  for (const row of quotes)
    if (!firstQuote.has(row.eventId)) firstQuote.set(row.eventId, row.quote);

  // No verified quote, no post: the quote is what makes it citable.
  return rows.flatMap((row) => {
    const quote = firstQuote.get(row.eventId);
    if (quote === undefined || row.kind === null) return [];
    return [
      {
        eventId: row.eventId,
        language: row.facts.language === "ru" ? ("ru" as const) : ("en" as const),
        company: row.company,
        kind: row.kind,
        summary: row.summary,
        quote,
        sourceUrl: row.sourceUrl,
      },
    ];
  });
}

function toDraft(postId: string, event: RadarEvent): RadarPostDraft {
  return {
    postId,
    language: event.language,
    company: event.company,
    slug: slugify(event.company),
    kind: event.kind,
    summary: event.summary,
    quote: event.quote,
    sourceUrl: event.sourceUrl,
  };
}
