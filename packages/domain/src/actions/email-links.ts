/**
 * What the links in a digest email do.
 *
 * An email client carries no session, so these are looked up by id alone: the
 * caller has already checked the signed token that names the card or the
 * profile, and that signature is the authorisation. Never call them with an id
 * that did not come out of a verified token.
 *
 * // TODO: security review — unscoped reads behind signed email links
 */

import { type Queryable, schema } from "@mifluent/db";
import { eq, sql } from "drizzle-orm";
import type { CardAction } from "./card-action-kinds.js";
import { findCardOwner, recordCardAction } from "./card-actions.js";

export interface EmailCardSummary {
  readonly headline: string;
}

/** The headline the confirmation page shows, so a reader knows what they are pressing on. */
export async function findEmailCard(
  db: Queryable,
  cardId: string,
): Promise<EmailCardSummary | undefined> {
  const [card] = await db
    .select({ headline: schema.digestCards.headline })
    .from(schema.digestCards)
    .where(eq(schema.digestCards.id, cardId))
    .limit(1);
  return card;
}

/** A press on an email button, recorded exactly as the same press in Telegram is. */
export async function recordEmailCardAction(
  db: Queryable,
  cardId: string,
  action: CardAction,
): Promise<boolean> {
  const owner = await findCardOwner(db, cardId);
  if (owner === undefined) return false;
  await recordCardAction(db, { tenantId: owner.tenantId, cardId, action, surface: "email" });
  return true;
}

/**
 * Stops email digests for one profile. Telegram delivery, the web page and
 * the account are untouched; the same link turns email back on.
 * Repeating it keeps the first date.
 */
export async function pauseEmailDelivery(
  db: Queryable,
  profileId: string,
  now: Date,
): Promise<boolean> {
  const paused = await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`jsonb_set(${schema.watchProfiles.delivery}, '{emailPausedAt}', coalesce(nullif(${schema.watchProfiles.delivery} -> 'emailPausedAt', 'null'::jsonb), to_jsonb(${now}::timestamptz)))`,
      updatedAt: now,
    })
    .where(eq(schema.watchProfiles.id, profileId))
    .returning({ id: schema.watchProfiles.id });
  return paused.length > 0;
}

/** Undoes `pauseEmailDelivery` — the "I clicked by mistake" button on the same page. */
export async function resumeEmailDelivery(
  db: Queryable,
  profileId: string,
  now: Date,
): Promise<boolean> {
  const resumed = await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`jsonb_set(${schema.watchProfiles.delivery}, '{emailPausedAt}', 'null'::jsonb)`,
      updatedAt: now,
    })
    .where(eq(schema.watchProfiles.id, profileId))
    .returning({ id: schema.watchProfiles.id });
  return resumed.length > 0;
}
