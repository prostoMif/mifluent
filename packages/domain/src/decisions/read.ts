/**
 * Reading decisions back out.
 *
 * The only reader today is the export command — the target page that will show
 * these in a timeline is a separate task, after the gate. Ordered oldest first
 * because an export is read as a history, not as a feed.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { asc, eq } from "drizzle-orm";

export interface DecisionRecord {
  readonly id: string;
  readonly profileId: string;
  readonly eventId: string | null;
  readonly targetId: string | null;
  readonly targetName: string | null;
  /** What the event was, when it is still on record. */
  readonly eventSummary: string | null;
  readonly text: string;
  readonly revisitAt: Date | null;
  readonly createdAt: Date;
}

export async function listDecisions(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<DecisionRecord[]> {
  return db
    .select({
      id: schema.decisions.id,
      profileId: schema.decisions.profileId,
      eventId: schema.decisions.eventId,
      targetId: schema.decisions.targetId,
      targetName: schema.watchTargets.name,
      eventSummary: schema.events.summary,
      text: schema.decisions.text,
      revisitAt: schema.decisions.revisitAt,
      createdAt: schema.decisions.createdAt,
    })
    .from(schema.decisions)
    .leftJoin(schema.events, eq(schema.events.id, schema.decisions.eventId))
    .leftJoin(schema.watchTargets, eq(schema.watchTargets.id, schema.decisions.targetId))
    .where(scoped(schema.decisions, tenantId, eq(schema.decisions.profileId, profileId)))
    .orderBy(asc(schema.decisions.createdAt));
}
