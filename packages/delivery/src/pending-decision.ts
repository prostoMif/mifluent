/**
 * Remembering which card a question was asked about.
 *
 * Telegram's `force_reply` carries no payload of ours: the answer arrives with
 * nothing but the id of the message it replies to. So the question's message
 * id is stored against the profile, next to the chat id the question went to,
 * and the answer is matched against it.
 *
 * One pending question per profile, on purpose — a `force_reply` box is a
 * single-question interface, and a queue of half-answered questions is worse
 * than asking the reader to press the button again.
 *
 * The answer itself is never stored here; it goes to `decisions` and nowhere
 * else.
 */

import { type Queryable, schema, scopedAlive } from "@mifluent/db";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface PendingDecision {
  readonly cardId: string;
  /** The question message. The answer's `reply_to_message` must match it. */
  readonly messageId: number;
  readonly askedAt: Date;
}

export interface ChatProfile {
  readonly tenantId: string;
  readonly profileId: string;
  readonly pending: PendingDecision | undefined;
}

/**
 * How long an unanswered question stays answerable. A day is the span in which
 * somebody opens a chat, gets interrupted, and comes back to it; past that the
 * card is no longer what they had in mind, so the handler asks again rather
 * than filing an answer against the wrong change.
 */
export const DECISION_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The profiles delivering to a chat, with any outstanding question.
 *
 * Unscoped by tenant, for the same reason `consumeBindingCode` is: a chat has
 * no session. The chat id is what the lookup is *by*, and it was put there by
 * someone holding a binding code, so a caller can only ever reach the profiles
 * that chose to deliver to it. Every write afterwards is scoped by the tenant
 * this returns.
 */
export async function listChatProfiles(db: Queryable, chatId: string): Promise<ChatProfile[]> {
  const rows = await db
    .select({
      tenantId: schema.watchProfiles.tenantId,
      profileId: schema.watchProfiles.id,
      delivery: schema.watchProfiles.delivery,
    })
    .from(schema.watchProfiles)
    .where(
      and(
        sql`${schema.watchProfiles.delivery}->>'telegramChatId' = ${chatId}`,
        isNull(schema.watchProfiles.deletedAt),
      ),
    );

  return rows.map((row) => ({
    tenantId: row.tenantId,
    profileId: row.profileId,
    pending: toPending(row.delivery.pendingDecision),
  }));
}

export async function setPendingDecision(
  db: Queryable,
  tenantId: string,
  profileId: string,
  pending: PendingDecision,
): Promise<void> {
  const value = JSON.stringify({
    cardId: pending.cardId,
    messageId: pending.messageId,
    askedAt: pending.askedAt.toISOString(),
  });

  await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`${schema.watchProfiles.delivery} || jsonb_build_object('pendingDecision', ${value}::jsonb)`,
    })
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)));
}

export async function clearPendingDecision(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<void> {
  await db
    .update(schema.watchProfiles)
    .set({ delivery: sql`${schema.watchProfiles.delivery} - 'pendingDecision'` })
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)));
}

/** Whether an answer arriving now still belongs to this question. */
export function isWithinReplyWindow(pending: PendingDecision, now: Date): boolean {
  return now.getTime() - pending.askedAt.getTime() <= DECISION_REPLY_WINDOW_MS;
}

function toPending(
  stored: NonNullable<typeof schema.watchProfiles.$inferSelect.delivery>["pendingDecision"],
): PendingDecision | undefined {
  if (stored === undefined) return undefined;
  const askedAt = new Date(stored.askedAt);
  if (Number.isNaN(askedAt.getTime())) return undefined;
  return { cardId: stored.cardId, messageId: stored.messageId, askedAt };
}
