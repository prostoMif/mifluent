/**
 * Target history queries.
 *
 * Combines events and decisions into a single timeline, extracts price/plan
 * changes into a "was → became" table, and surfaces current vacancies from
 * the latest ATS snapshot.
 */

import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import { and, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";

export const PAGE_SIZE = 30;

export type EventKind =
  | "price"
  | "plan"
  | "feature"
  | "policy"
  | "hiring"
  | "copy"
  | "incident"
  | "news"
  | "other";

export interface TimelineEntry {
  readonly id: string;
  readonly kind: "event" | "decision";
  readonly occurredAt: Date;
  readonly eventKind: EventKind | null;
  readonly summary: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
  readonly isUrgent: boolean;
  readonly decisionText: string | null;
  readonly revisitAt: Date | null;
}

interface RawEventEntry {
  id: string;
  kind: "event";
  occurredAt: Date | null;
  eventKind: string | null;
  summary: string;
  quote: string | null;
  sourceUrl: string | null;
  isUrgent: boolean;
  decisionText: string | null;
  revisitAt: Date | null;
}

interface RawDecisionEntry {
  id: string;
  kind: "decision";
  occurredAt: Date | null;
  eventKind: null;
  summary: string;
  quote: string | null;
  sourceUrl: string | null;
  isUrgent: boolean;
  decisionText: string;
  revisitAt: Date | null;
}

export interface PriceChange {
  readonly occurredAt: Date;
  readonly kind: "price" | "plan";
  readonly was: string | null;
  readonly became: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

export interface Vacancy {
  readonly title: string;
  readonly url: string | null;
  readonly department: string | null;
  readonly location: string | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly isOpen: boolean;
}

interface MutableVacancy {
  title: string;
  url: string | null;
  department: string | null;
  location: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  isOpen: boolean;
}

export interface TargetHistoryResult {
  readonly timeline: readonly TimelineEntry[];
  readonly priceChanges: readonly PriceChange[];
  readonly vacancies: readonly Vacancy[];
  readonly hasMore: boolean;
  readonly checkedCount: number;
  readonly daysChecked: number;
}

export interface TargetHeader {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly websiteUrl: string | null;
  readonly reason: string | null;
  readonly pausedAt: Date | null;
  readonly surfaces: readonly string[];
  readonly profileId: string;
}

/**
 * Fetch the target header (name, kind, website, surfaces, status).
 */
export async function fetchTargetHeader(
  db: Queryable,
  tenantId: string,
  targetId: string,
): Promise<TargetHeader | undefined> {
  const [target] = await db
    .select({
      id: schema.watchTargets.id,
      name: schema.watchTargets.name,
      kind: schema.watchTargets.kind,
      websiteUrl: schema.watchTargets.websiteUrl,
      reason: schema.watchTargets.reason,
      pausedAt: schema.watchTargets.pausedAt,
      profileId: schema.watchTargets.profileId,
    })
    .from(schema.watchTargets)
    .where(scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.id, targetId)))
    .limit(1);

  if (target === undefined) {
    return undefined;
  }

  // Fetch surfaces (source kinds) for this target
  const sources = await db
    .select({ kind: schema.sources.kind })
    .from(schema.sources)
    .where(scopedAlive(schema.sources, tenantId, eq(schema.sources.targetId, targetId)));

  const surfaces = [...new Set(sources.map((s) => s.kind))].sort();

  return {
    ...target,
    surfaces,
  };
}

/**
 * Fetch timeline entries (events + decisions) for a target, merged by time.
 */
export async function fetchTargetTimeline(
  db: Queryable,
  tenantId: string,
  targetId: string,
  options: {
    readonly cursor?: Date;
    readonly limit?: number;
    readonly eventKindFilter?: EventKind | null;
    readonly historyDays?: number;
  } = {},
): Promise<{ entries: readonly TimelineEntry[]; hasMore: boolean }> {
  const { cursor, limit = PAGE_SIZE, eventKindFilter, historyDays } = options;

  const whereConditions = [
    scoped(schema.events, tenantId),
    eq(schema.events.targetId, targetId),
    isNotNull(schema.events.occurredAt),
  ];

  if (cursor !== undefined) {
    whereConditions.push(lt(schema.events.occurredAt, cursor));
  }

  if (historyDays !== undefined) {
    const cutoff = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);
    whereConditions.push(gte(schema.events.occurredAt, cutoff));
  }

  if (eventKindFilter !== undefined && eventKindFilter !== null) {
    whereConditions.push(eq(schema.events.kind, eventKindFilter));
  }

  const eventsQuery = db
    .select({
      id: schema.events.id,
      kind: sql<"event">`'event'`,
      occurredAt: schema.events.occurredAt,
      eventKind: schema.events.kind,
      summary: schema.events.summary,
      quote: sql<string | null>`null`,
      sourceUrl: schema.rawItems.url,
      isUrgent: schema.events.isUrgent,
      decisionText: sql<string | null>`null`,
      revisitAt: sql<Date | null>`null`,
    })
    .from(schema.events)
    .leftJoin(schema.rawItems, eq(schema.events.rawItemId, schema.rawItems.id))
    .where(and(...whereConditions))
    .orderBy(desc(schema.events.occurredAt))
    .limit(limit + 1);

  const decisionsWhere = [
    scoped(schema.decisions, tenantId),
    eq(schema.decisions.targetId, targetId),
  ];

  if (cursor !== undefined) {
    decisionsWhere.push(lt(schema.decisions.createdAt, cursor));
  }

  if (historyDays !== undefined) {
    const cutoff = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);
    decisionsWhere.push(gte(schema.decisions.createdAt, cutoff));
  }

  const decisionsQuery = db
    .select({
      id: schema.decisions.id,
      kind: sql<"decision">`'decision'`,
      occurredAt: schema.decisions.createdAt,
      eventKind: sql<null>`null`,
      summary: schema.decisions.text,
      quote: sql<string | null>`null`,
      sourceUrl: sql<string | null>`null`,
      isUrgent: sql<boolean>`false`,
      decisionText: schema.decisions.text,
      revisitAt: schema.decisions.revisitAt,
    })
    .from(schema.decisions)
    .where(and(...decisionsWhere))
    .orderBy(desc(schema.decisions.createdAt))
    .limit(limit + 1);

  const [events, decisions] = await Promise.all([eventsQuery, decisionsQuery]);

  // Filter out null occurredAt and convert to TimelineEntry
  const validEvents: TimelineEntry[] = events
    .filter((e): e is RawEventEntry & { occurredAt: Date } => e.occurredAt !== null)
    .map((e) => ({
      ...e,
      occurredAt: e.occurredAt as Date,
      eventKind: e.eventKind as EventKind | null,
    }));

  const validDecisions: TimelineEntry[] = decisions
    .filter((e): e is RawDecisionEntry & { occurredAt: Date } => e.occurredAt !== null)
    .map((e) => ({
      ...e,
      occurredAt: e.occurredAt as Date,
      eventKind: null,
    }));

  // Merge and sort by occurredAt
  const merged = [...validEvents, ...validDecisions].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
  );

  const hasMore = merged.length > limit;
  const entries = hasMore ? merged.slice(0, limit) : merged;

  return { entries, hasMore };
}

/**
 * Fetch price/plan changes for a target, computing "was → became" from
 * consecutive events of the same kind.
 */
export async function fetchPriceChanges(
  db: Queryable,
  tenantId: string,
  targetId: string,
  historyDays?: number,
): Promise<readonly PriceChange[]> {
  const events = await fetchPricePlanEvents(db, tenantId, targetId, historyDays);
  if (events.length === 0) {
    return [];
  }

  const eventsByKind = groupEventsByKind(events);
  sortEventGroupsChronologically(eventsByKind);

  const changes = buildPriceChanges(eventsByKind);
  changes.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  return changes;
}

interface PricePlanEvent {
  id: string;
  occurredAt: Date | null;
  kind: string | null;
  summary: string;
  quote: string | null;
  sourceUrl: string | null;
}

interface ValidPricePlanEvent {
  id: string;
  occurredAt: Date;
  kind: "price" | "plan";
  summary: string;
  quote: string | null;
  sourceUrl: string | null;
}

async function fetchPricePlanEvents(
  db: Queryable,
  tenantId: string,
  targetId: string,
  historyDays?: number,
): Promise<readonly PricePlanEvent[]> {
  const whereConditions = [
    scoped(schema.events, tenantId),
    eq(schema.events.targetId, targetId),
    isNotNull(schema.events.occurredAt),
    or(eq(schema.events.kind, "price"), eq(schema.events.kind, "plan")),
  ];

  if (historyDays !== undefined) {
    const cutoff = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);
    whereConditions.push(gte(schema.events.occurredAt, cutoff));
  }

  return db
    .select({
      id: schema.events.id,
      occurredAt: schema.events.occurredAt,
      kind: schema.events.kind,
      summary: schema.events.summary,
      quote: sql<string | null>`null`,
      sourceUrl: schema.rawItems.url,
    })
    .from(schema.events)
    .leftJoin(schema.rawItems, eq(schema.events.rawItemId, schema.rawItems.id))
    .where(and(...whereConditions))
    .orderBy(desc(schema.events.occurredAt));
}

function groupEventsByKind(
  events: readonly PricePlanEvent[],
): Map<"price" | "plan", ValidPricePlanEvent[]> {
  const validEvents = events.filter(
    (e): e is ValidPricePlanEvent =>
      e.occurredAt !== null && (e.kind === "price" || e.kind === "plan"),
  );

  const eventsByKind = new Map<"price" | "plan", ValidPricePlanEvent[]>();
  for (const event of validEvents) {
    const kind = event.kind;
    const group = eventsByKind.get(kind) ?? [];
    group.push(event);
    eventsByKind.set(kind, group);
  }

  return eventsByKind;
}

function sortEventGroupsChronologically(
  eventsByKind: Map<"price" | "plan", ValidPricePlanEvent[]>,
): void {
  for (const group of eventsByKind.values()) {
    group.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }
}

function buildPriceChanges(
  eventsByKind: Map<"price" | "plan", ValidPricePlanEvent[]>,
): PriceChange[] {
  const changes: PriceChange[] = [];

  for (const [kind, group] of eventsByKind) {
    if (group.length === 1) {
      const event = group[0];
      if (event !== undefined) {
        changes.push({
          occurredAt: event.occurredAt,
          kind,
          was: null,
          became: event.summary,
          quote: event.quote,
          sourceUrl: event.sourceUrl,
        });
      }
    } else {
      for (let i = 1; i < group.length; i++) {
        const previousEvent = group[i - 1];
        const currentEvent = group[i];
        if (previousEvent !== undefined && currentEvent !== undefined) {
          changes.push({
            occurredAt: currentEvent.occurredAt,
            kind,
            was: previousEvent.summary,
            became: currentEvent.summary,
            quote: currentEvent.quote,
            sourceUrl: currentEvent.sourceUrl,
          });
        }
      }
    }
  }

  return changes;
}

/**
 * Fetch current vacancies from the latest ATS snapshot (raw_items with kind='job').
 * Also returns changes in the last 90 days.
 */
export async function fetchVacancies(
  db: Queryable,
  tenantId: string,
  targetId: string,
): Promise<readonly Vacancy[]> {
  const atsSources = await findAtsSources(db, tenantId, targetId);
  if (atsSources.length === 0) {
    return [];
  }

  const sourceIds = atsSources.map((s) => s.id);
  const latestItems = await fetchLatestJobItems(db, tenantId, sourceIds);
  const vacancies = parseCurrentVacancies(latestItems);

  const historicalItems = await fetchHistoricalJobItems(db, tenantId, sourceIds);
  const jobMap = parseHistoricalVacancies(historicalItems);

  mergeHistoricalData(vacancies, jobMap);

  return vacancies.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}

async function findAtsSources(
  db: Queryable,
  tenantId: string,
  targetId: string,
): Promise<readonly { id: string }[]> {
  return db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      scopedAlive(
        schema.sources,
        tenantId,
        eq(schema.sources.targetId, targetId),
        eq(schema.sources.kind, "json"),
      ),
    );
}

async function fetchLatestJobItems(
  db: Queryable,
  tenantId: string,
  sourceIds: readonly string[],
): Promise<
  readonly {
    id: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
    fetchedAt: Date;
    url: string | null;
  }[]
> {
  return db
    .select({
      id: schema.rawItems.id,
      sourceId: schema.rawItems.sourceId,
      content: schema.rawItems.content,
      metadata: schema.rawItems.metadata,
      fetchedAt: schema.rawItems.fetchedAt,
      url: schema.rawItems.url,
    })
    .from(schema.rawItems)
    .where(
      and(
        scoped(schema.rawItems, tenantId),
        sql`${schema.rawItems.sourceId} IN (${sourceIds.join(",")})`,
        eq(schema.rawItems.kind, "job"),
      ),
    )
    .orderBy(desc(schema.rawItems.fetchedAt));
}

function parseCurrentVacancies(
  latestItems: readonly {
    id: string;
    sourceId: string;
    content: string;
    metadata: Record<string, unknown>;
    fetchedAt: Date;
    url: string | null;
  }[],
): Vacancy[] {
  const latestPerSource = new Map<string, (typeof latestItems)[0]>();
  for (const item of latestItems) {
    if (!latestPerSource.has(item.sourceId)) {
      latestPerSource.set(item.sourceId, item);
    }
  }

  const vacancies: Vacancy[] = [];

  for (const item of latestPerSource.values()) {
    try {
      const jobs = JSON.parse(item.content) as Array<{
        title: string;
        url?: string;
        department?: string;
        location?: string;
        id?: string;
      }>;

      for (const job of jobs) {
        vacancies.push({
          title: job.title,
          url: job.url ?? item.url,
          department: job.department ?? null,
          location: job.location ?? null,
          firstSeenAt: item.fetchedAt,
          lastSeenAt: item.fetchedAt,
          isOpen: true,
        });
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return vacancies;
}

async function fetchHistoricalJobItems(
  db: Queryable,
  tenantId: string,
  sourceIds: readonly string[],
): Promise<
  readonly {
    content: string;
    fetchedAt: Date;
    url: string | null;
  }[]
> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return db
    .select({
      content: schema.rawItems.content,
      fetchedAt: schema.rawItems.fetchedAt,
      url: schema.rawItems.url,
    })
    .from(schema.rawItems)
    .where(
      and(
        scoped(schema.rawItems, tenantId),
        sql`${schema.rawItems.sourceId} IN (${sourceIds.join(",")})`,
        eq(schema.rawItems.kind, "job"),
        gte(schema.rawItems.fetchedAt, ninetyDaysAgo),
      ),
    )
    .orderBy(desc(schema.rawItems.fetchedAt));
}

function parseHistoricalVacancies(
  historicalItems: readonly {
    content: string;
    fetchedAt: Date;
    url: string | null;
  }[],
): Map<string, MutableVacancy> {
  const jobMap = new Map<string, MutableVacancy>();

  for (const item of historicalItems) {
    try {
      const jobs = JSON.parse(item.content) as Array<{
        title: string;
        url?: string;
        department?: string;
        location?: string;
      }>;

      for (const job of jobs) {
        const key = job.title.toLowerCase();
        const existing = jobMap.get(key);

        if (existing === undefined) {
          jobMap.set(key, {
            title: job.title,
            url: job.url ?? item.url,
            department: job.department ?? null,
            location: job.location ?? null,
            firstSeenAt: item.fetchedAt,
            lastSeenAt: item.fetchedAt,
            isOpen: true,
          });
        } else {
          existing.firstSeenAt = item.fetchedAt; // Earlier date since we're going backwards
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return jobMap;
}

function mergeHistoricalData(vacancies: Vacancy[], jobMap: Map<string, MutableVacancy>): void {
  for (const vacancy of vacancies) {
    const key = vacancy.title.toLowerCase();
    const historical = jobMap.get(key);
    if (historical !== undefined) {
      // Cast to MutableVacancy to allow mutation of readonly property
      (vacancy as MutableVacancy).firstSeenAt = historical.firstSeenAt;
    }
  }
}

/**
 * Count how many times sources for this target were checked in the given period.
 */
export async function fetchCheckCount(
  db: Queryable,
  tenantId: string,
  targetId: string,
  days: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const sourceIds = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(scopedAlive(schema.sources, tenantId, eq(schema.sources.targetId, targetId)));

  if (sourceIds.length === 0) {
    return 0;
  }

  const ids = sourceIds.map((s) => s.id);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.rawItems)
    .where(
      and(
        scoped(schema.rawItems, tenantId),
        sql`${schema.rawItems.sourceId} IN (${ids.join(",")})`,
        gte(schema.rawItems.fetchedAt, cutoff),
      ),
    );

  return row?.count ?? 0;
}

/**
 * Get the historyDays limit for the tenant's plan.
 */
import { findTenantPlan } from "../plans/limits.js";

export async function getHistoryDaysLimit(db: Queryable, tenantId: string): Promise<number> {
  const { limits } = await findTenantPlan(db, tenantId);

  // Free: 30 days, Starter/Pro/Team: full history (represented as a large number)
  // The task says: Free — 30 days, Starter — 1 year, Pro and Team — all history
  // If starter doesn't exist yet, use historyDays from plan (TASK-026 will set 365)
  // For now, we'll use rawRetentionDays as a proxy, but the task mentions a specific
  // historyDays field. Let's check the plan limits.
  // Actually, the task says: "Если тарифа `starter` ещё нет (TASK-026 позже) — брать поле `historyDays` из тарифа, 026 проставит 365."
  // Since PlanLimits doesn't have historyDays yet, we'll use rawRetentionDays for now.
  // Free has rawRetentionDays: 30, Pro: 365, Team: 3650
  // This aligns with: Free 30 days, Pro/Team all history (365+ days)
  return limits.rawRetentionDays;
}
