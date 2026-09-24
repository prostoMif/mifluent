/**
 * What a reader did with a card.
 *
 * Every press is written to `user_actions` — it is the training signal for the
 * classifier that replaces the cheap model in v2, and it cannot be collected
 * retroactively. "Not following this" also pauses the target, so the reader
 * stops getting cards about it without having to find the profile editor.
 *
 * The same function serves the Telegram buttons and the web page, so the two
 * cannot drift into recording different things.
 *
 * // TODO: security review — authorisation
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { eq } from "drizzle-orm";
import type { TelegramCardAction } from "./card-action-kinds.js";

export interface CardActionInput {
  readonly tenantId: string;
  readonly cardId: string;
  readonly action: TelegramCardAction;
  readonly surface: "web" | "telegram";
  /** The signed-in person on the web; unknown for a Telegram press. */
  readonly userId?: string | undefined;
}

export interface CardOwner {
  readonly tenantId: string;
  readonly eventId: string;
  readonly profileId: string;
  readonly telegramChatId: string | null;
}

/**
 * Who a card belongs to, looked up by id alone.
 *
 * The one unscoped read in this file, because a Telegram press arrives with a
 * card id and a chat id and nothing else. The caller must compare the chat id
 * it returns with the one that pressed before acting — see the Telegram update
 * handler.
 */
export async function findCardOwner(db: Queryable, cardId: string): Promise<CardOwner | undefined> {
  const [row] = await db
    .select({
      tenantId: schema.digestCards.tenantId,
      eventId: schema.digestCards.eventId,
      profileId: schema.digests.profileId,
      delivery: schema.watchProfiles.delivery,
    })
    .from(schema.digestCards)
    .innerJoin(schema.digests, eq(schema.digests.id, schema.digestCards.digestId))
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.digests.profileId))
    .where(eq(schema.digestCards.id, cardId))
    .limit(1);

  if (row === undefined) return undefined;
  return {
    tenantId: row.tenantId,
    eventId: row.eventId,
    profileId: row.profileId,
    telegramChatId: row.delivery.telegramChatId ?? null,
  };
}

export async function recordCardAction(db: Queryable, input: CardActionInput): Promise<void> {
  const [card] = await db
    .select({ eventId: schema.digestCards.eventId, targetId: schema.events.targetId })
    .from(schema.digestCards)
    .innerJoin(schema.events, eq(schema.events.id, schema.digestCards.eventId))
    .where(scoped(schema.digestCards, input.tenantId, eq(schema.digestCards.id, input.cardId)))
    .limit(1);

  if (card === undefined) {
    throw new AppError("not_found", "Not found.");
  }

  await db.transaction(async (transaction) => {
    await transaction.insert(schema.userActions).values({
      id: uuidv7(),
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      kind: input.action,
      cardId: input.cardId,
      eventId: card.eventId,
      surface: input.surface,
    });

    if (input.action === "not_following_target" && card.targetId !== null) {
      await transaction
        .update(schema.watchTargets)
        .set({ pausedAt: new Date(), updatedAt: new Date() })
        .where(
          scoped(schema.watchTargets, input.tenantId, eq(schema.watchTargets.id, card.targetId)),
        );
    }
  });
}
