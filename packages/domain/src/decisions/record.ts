/**
 * Writing down what the reader decided.
 *
 * The text arrives from a chat message and is the most sensitive thing this
 * product stores, so it is handled once, here: trimmed, capped, written, and
 * never passed to a logger, a model or a telemetry counter. Callers get back
 * the identifier and the target's name — enough to confirm to the reader —
 * and nothing that would tempt them to echo the text somewhere else.
 *
 * The card is read under the tenant predicate first, which is what makes the
 * event and target on the decision trustworthy: they come from the row, never
 * from the caller.
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { MAXIMUM_DECISION_LENGTH, type Queryable, schema, scoped } from "@mifluent/db";
import { eq } from "drizzle-orm";

export interface DecisionInput {
  readonly tenantId: string;
  /** The card the reader pressed "It changed a decision" on. */
  readonly cardId: string;
  /** One line, in the reader's own words. Capped, never rejected for length. */
  readonly text: string;
}

export interface RecordedDecision {
  readonly id: string;
  /** For the confirmation line. Null when the event had no target. */
  readonly targetName: string | null;
}

export async function recordDecision(
  db: Queryable,
  input: DecisionInput,
): Promise<RecordedDecision> {
  const text = input.text.trim().slice(0, MAXIMUM_DECISION_LENGTH);
  if (text === "") {
    throw new AppError("validation_failed", "Write one line about what you decided.");
  }

  const [card] = await db
    .select({
      eventId: schema.digestCards.eventId,
      profileId: schema.digests.profileId,
      targetId: schema.events.targetId,
      targetName: schema.watchTargets.name,
    })
    .from(schema.digestCards)
    .innerJoin(schema.digests, eq(schema.digests.id, schema.digestCards.digestId))
    .innerJoin(schema.events, eq(schema.events.id, schema.digestCards.eventId))
    .leftJoin(schema.watchTargets, eq(schema.watchTargets.id, schema.events.targetId))
    .where(scoped(schema.digestCards, input.tenantId, eq(schema.digestCards.id, input.cardId)))
    .limit(1);

  if (card === undefined) {
    throw new AppError("not_found", "Not found.");
  }

  const id = uuidv7();
  await db.insert(schema.decisions).values({
    id,
    tenantId: input.tenantId,
    profileId: card.profileId,
    eventId: card.eventId,
    targetId: card.targetId,
    text,
  });

  return { id, targetName: card.targetName };
}
