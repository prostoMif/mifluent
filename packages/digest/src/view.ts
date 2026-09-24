/**
 * Reading a built digest back, in the shape every renderer uses.
 *
 * Telegram and the web page render the same thing from the same read, so a
 * card cannot say one thing in a chat and another on `/today`.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import type { DigestNotice } from "@mifluent/db/schema";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";

export interface DigestBlockView {
  readonly kind: "fact" | "implication" | "analyst_opinion" | "model_interpretation";
  readonly content: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

export interface DigestCardView {
  readonly id: string;
  readonly eventId: string;
  readonly kind: "event" | "group";
  readonly headline: string;
  readonly sourceUrl: string | null;
  readonly ageDays: number | null;
  readonly moreCount: number;
  readonly isUrgent: boolean;
  readonly blocks: readonly DigestBlockView[];
}

export interface DigestView {
  readonly id: string;
  readonly tenantId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly language: "en" | "ru";
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly isUrgent: boolean;
  readonly status: "pending" | "delivered" | "failed";
  readonly channel: "telegram" | "email" | "web_only";
  readonly telegramChatId: string | null;
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
  readonly nearMisses: readonly { title: string; url: string | null; reason: string }[];
  readonly notices: readonly DigestNotice[];
  readonly cards: readonly DigestCardView[];
}

const languageSchema = z.object({ language: z.enum(["en", "ru"]) }).catch({ language: "en" });

export async function loadDigestView(
  db: Queryable,
  tenantId: string,
  digestId: string,
): Promise<DigestView | undefined> {
  const [row] = await selectDigests(db, tenantId, eq(schema.digests.id, digestId)).limit(1);
  return row === undefined ? undefined : withCards(db, row);
}

/** The newest regular digest of a profile, for `/today`. */
export async function loadLatestDigestView(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<DigestView | undefined> {
  const [row] = await selectDigests(
    db,
    tenantId,
    and(
      eq(schema.digests.profileId, profileId),
      ne(schema.digests.periodStart, schema.digests.periodEnd),
    ),
  )
    .orderBy(desc(schema.digests.periodEnd))
    .limit(1);
  return row === undefined ? undefined : withCards(db, row);
}

/** Urgent digests of a profile since a moment, newest first — shown above the weekly one. */
export async function listRecentUrgentDigests(
  db: Queryable,
  tenantId: string,
  profileId: string,
  since: Date,
): Promise<DigestView[]> {
  const rows = await selectDigests(
    db,
    tenantId,
    and(
      eq(schema.digests.profileId, profileId),
      eq(schema.digests.periodStart, schema.digests.periodEnd),
    ),
  ).orderBy(desc(schema.digests.periodEnd));

  const recent = rows.filter((row) => row.periodEnd.getTime() >= since.getTime());
  return Promise.all(recent.map((row) => withCards(db, row)));
}

type DigestRow = Awaited<ReturnType<typeof selectDigests>>[number];

function selectDigests(db: Queryable, tenantId: string, condition: ReturnType<typeof and>) {
  return db
    .select({
      id: schema.digests.id,
      tenantId: schema.digests.tenantId,
      profileId: schema.digests.profileId,
      profileName: schema.watchProfiles.name,
      facts: schema.watchProfiles.facts,
      delivery: schema.watchProfiles.delivery,
      periodStart: schema.digests.periodStart,
      periodEnd: schema.digests.periodEnd,
      status: schema.digests.status,
      channel: schema.digests.channel,
      sourcesChecked: schema.digests.sourcesChecked,
      itemsConsidered: schema.digests.itemsConsidered,
      nearMisses: schema.digests.nearMisses,
      notices: schema.digests.notices,
    })
    .from(schema.digests)
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.digests.profileId))
    .where(scoped(schema.digests, tenantId, condition));
}

async function withCards(db: Queryable, row: DigestRow): Promise<DigestView> {
  const cards = await db
    .select({
      id: schema.digestCards.id,
      eventId: schema.digestCards.eventId,
      kind: schema.digestCards.kind,
      headline: schema.digestCards.headline,
      sourceUrl: schema.digestCards.sourceUrl,
      ageDays: schema.digestCards.ageDays,
      moreCount: schema.digestCards.moreCount,
      isUrgent: schema.events.isUrgent,
    })
    .from(schema.digestCards)
    .innerJoin(schema.events, eq(schema.events.id, schema.digestCards.eventId))
    .where(scoped(schema.digestCards, row.tenantId, eq(schema.digestCards.digestId, row.id)))
    .orderBy(asc(schema.digestCards.position));

  const blocks =
    cards.length === 0
      ? []
      : await db
          .select({
            cardId: schema.cardBlocks.cardId,
            kind: schema.cardBlocks.kind,
            content: schema.cardBlocks.content,
            quote: schema.cardBlocks.quote,
            sourceUrl: schema.cardBlocks.sourceUrl,
          })
          .from(schema.cardBlocks)
          .where(
            scoped(
              schema.cardBlocks,
              row.tenantId,
              inArray(
                schema.cardBlocks.cardId,
                cards.map((card) => card.id),
              ),
            ),
          )
          .orderBy(asc(schema.cardBlocks.position));

  return {
    id: row.id,
    tenantId: row.tenantId,
    profileId: row.profileId,
    profileName: row.profileName,
    language: languageSchema.parse(row.facts).language,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    isUrgent: row.periodStart.getTime() === row.periodEnd.getTime(),
    status: row.status,
    channel: row.channel,
    telegramChatId: row.delivery.telegramChatId ?? null,
    sourcesChecked: row.sourcesChecked,
    itemsConsidered: row.itemsConsidered,
    nearMisses: row.nearMisses,
    notices: row.notices,
    cards: cards.map((card) => ({
      ...card,
      kind: card.kind === "group" ? "group" : "event",
      blocks: blocks
        .filter((block) => block.cardId === card.id)
        .map(({ kind, content, quote, sourceUrl }) => ({ kind, content, quote, sourceUrl })),
    })),
  };
}
