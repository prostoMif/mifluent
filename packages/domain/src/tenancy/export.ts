/**
 * Everything a business has here, as one JSON document it can take away:
 * profiles, what they watch, every change found with its quotes, and the
 * decisions written against them. Scoped to the one tenant.
 */

import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import { asc } from "drizzle-orm";

export async function exportTenantData(db: Queryable, tenantId: string) {
  const [profiles, targets, sources, events, facts, decisions] = await Promise.all([
    db
      .select({
        id: schema.watchProfiles.id,
        name: schema.watchProfiles.name,
        businessDescription: schema.watchProfiles.businessDescription,
        websiteUrl: schema.watchProfiles.websiteUrl,
        facts: schema.watchProfiles.facts,
        createdAt: schema.watchProfiles.createdAt,
      })
      .from(schema.watchProfiles)
      .where(scopedAlive(schema.watchProfiles, tenantId)),
    db
      .select({
        id: schema.watchTargets.id,
        profileId: schema.watchTargets.profileId,
        kind: schema.watchTargets.kind,
        name: schema.watchTargets.name,
        websiteUrl: schema.watchTargets.websiteUrl,
        pausedAt: schema.watchTargets.pausedAt,
      })
      .from(schema.watchTargets)
      .where(scopedAlive(schema.watchTargets, tenantId)),
    db
      .select({
        id: schema.sources.id,
        profileId: schema.sources.profileId,
        targetId: schema.sources.targetId,
        kind: schema.sources.kind,
        label: schema.sources.label,
        locator: schema.sources.locator,
      })
      .from(schema.sources)
      .where(scopedAlive(schema.sources, tenantId)),
    db
      .select({
        id: schema.events.id,
        profileId: schema.events.profileId,
        targetId: schema.events.targetId,
        kind: schema.events.kind,
        summary: schema.events.summary,
        implication: schema.events.implication,
        sourceUrl: schema.events.sourceUrl,
        occurredAt: schema.events.occurredAt,
        createdAt: schema.events.createdAt,
      })
      .from(schema.events)
      .where(scoped(schema.events, tenantId))
      .orderBy(asc(schema.events.createdAt)),
    db
      .select({
        eventId: schema.facts.eventId,
        statement: schema.facts.statement,
        quote: schema.facts.quote,
      })
      .from(schema.facts)
      .where(scoped(schema.facts, tenantId)),
    db
      .select({
        id: schema.decisions.id,
        eventId: schema.decisions.eventId,
        targetId: schema.decisions.targetId,
        text: schema.decisions.text,
        revisitAt: schema.decisions.revisitAt,
        createdAt: schema.decisions.createdAt,
      })
      .from(schema.decisions)
      .where(scoped(schema.decisions, tenantId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profiles,
    targets,
    sources,
    events: events.map((event) => ({
      ...event,
      facts: facts.filter((fact) => fact.eventId === event.id),
    })),
    decisions,
  };
}
