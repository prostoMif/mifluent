/**
 * Monthly market report — the Pro feature that answers "what did I get this month".
 *
 * Built on the 1st of each month for the previous calendar month. It aggregates
 * all events across all targets into a structured report with:
 * 1. Top 3–5 events of the month (by type priority and cluster size)
 * 2. Per-target one-liner: "N events: ..." or "quiet"
 * 3. Price change table for the month
 * 4. Hiring: who hired the most
 * 5. Your decisions this month (count + links only, no text sent to model)
 * 6. Targets with no events or reactions for 60+ days — profile drift check
 *
 * The expensive model writes ONLY a 2–3 sentence intro from verified fact summaries.
 * Every sentence must reference an event ID from the input — validated in code.
 */

import { AppError, toSafeLink, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import type { LlmClient } from "@mifluent/llm";
import { desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

export type { Queryable } from "@mifluent/db";

/** The month this report covers, as "YYYY-MM" in UTC. */
export type MonthKey = string;

/** Event kinds ordered by importance for "top events" selection. */
const EVENT_KIND_PRIORITY: Readonly<Record<string, number>> = {
  price: 100,
  plan: 90,
  policy: 80,
  feature: 60,
  hiring: 50,
  incident: 40,
  copy: 20,
  cosmetic: 10,
  other: 5,
  news: 5,
} as const;

/** Maximum events to show in the "top events" section. */
const MAX_TOP_EVENTS = 5;

/** Minimum days of silence before a target is flagged as drifted. */
const DRIFT_SILENCE_DAYS = 60;

/** The schema for the model's monthly intro answer. */
export const monthlyIntroSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1).max(500),
        eventIds: z.array(z.string().uuid()).min(1).max(3),
      }),
    )
    .min(1)
    .max(3),
});

export type MonthlyIntroAnswer = z.infer<typeof monthlyIntroSchema>;

/** Input to the monthly intro prompt: verified fact summaries per event. */
export interface MonthlyEventSummary {
  readonly id: string;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly targetKind: string | null;
  readonly kind: string | null;
  readonly summary: string;
  readonly facts: readonly { readonly statement: string; readonly quote: string }[];
  readonly occurredAt: Date;
  readonly sourceUrl: string | null;
}

/** Aggregated data for one target in the monthly report. */
export interface MonthlyTargetSummary {
  readonly targetId: string;
  readonly targetName: string;
  readonly targetKind: string;
  readonly eventCount: number;
  readonly topEventKinds: readonly string[];
  readonly oneLiner: string;
  readonly isQuiet: boolean;
}

/** Price change row for the monthly table. */
export interface MonthlyPriceChange {
  readonly targetId: string;
  readonly targetName: string;
  readonly occurredAt: Date;
  readonly kind: "price" | "plan";
  readonly was: string | null;
  readonly became: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
}

/** Hiring summary per target. */
export interface MonthlyHiringSummary {
  readonly targetId: string;
  readonly targetName: string;
  readonly openCount: number;
  readonly newThisMonth: number;
  readonly departments: readonly string[];
}

/** User decision summary (count + links only). */
export interface MonthlyDecisionSummary {
  readonly count: number;
  readonly decisionIds: readonly string[];
}

/** Drifted target (no events or reactions for 60+ days). */
export interface MonthlyDriftedTarget {
  readonly targetId: string;
  readonly targetName: string;
  readonly targetKind: string;
  readonly lastEventAt: Date | null;
  readonly lastReactionAt: Date | null;
  readonly daysSinceActivity: number;
}

/** Complete monthly report data, ready for rendering. */
export interface MonthlyReportData {
  readonly month: MonthKey;
  readonly profileId: string;
  readonly profileName: string;
  readonly language: "en" | "ru";
  readonly topEvents: readonly MonthlyEventSummary[];
  readonly targetSummaries: readonly MonthlyTargetSummary[];
  readonly priceChanges: readonly MonthlyPriceChange[];
  readonly hiringSummaries: readonly MonthlyHiringSummary[];
  readonly decisions: MonthlyDecisionSummary;
  readonly driftedTargets: readonly MonthlyDriftedTarget[];
  readonly intro: MonthlyIntroAnswer | null;
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
  readonly generatedAt: Date;
}

/** Context for building a monthly report. */
export interface MonthlyBuildContext {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly profileId: string;
  readonly month: MonthKey; // "YYYY-MM"
  readonly llm?: LlmClient;
  readonly dryRun?: boolean;
}

/**
 * Build the monthly market report for a profile.
 * Returns the report data; does not persist it (the caller decides).
 */
export async function buildMonthlyReport(context: MonthlyBuildContext): Promise<MonthlyReportData> {
  const { db, tenantId, profileId, month, llm, dryRun } = context;

  // Parse month boundaries
  const [yearStr, monthStr] = month.split("-") as [string, string];
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

  // Load profile info
  const [profile] = await db
    .select({
      name: schema.watchProfiles.name,
      facts: schema.watchProfiles.facts,
    })
    .from(schema.watchProfiles)
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);

  if (profile === undefined) {
    throw new AppError("not_found", "Profile not found.");
  }

  const language = (profile.facts?.language as "en" | "ru") ?? "en";

  // Load all events for this profile in the month
  const events = await loadMonthlyEvents(db, tenantId, profileId, monthStart, monthEnd);

  // Load all targets for this profile
  const targets = await db
    .select({
      id: schema.watchTargets.id,
      name: schema.watchTargets.name,
      kind: schema.watchTargets.kind,
      pausedAt: schema.watchTargets.pausedAt,
    })
    .from(schema.watchTargets)
    .where(scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.profileId, profileId)))
    .orderBy(schema.watchTargets.name);

  // 1. Top events of the month
  const topEvents = selectTopEvents(events, targets);

  // 2. Per-target summaries
  const targetSummaries = buildTargetSummaries(events, targets, monthStart, monthEnd);

  // 3. Price changes
  const priceChanges = await loadMonthlyPriceChanges(db, tenantId, profileId, monthStart, monthEnd);

  // 4. Hiring summaries
  const hiringSummaries = await loadMonthlyHiring(db, tenantId, profileId, monthStart, monthEnd);

  // 5. User decisions (count + links only)
  const decisions = await loadMonthlyDecisions(db, tenantId, profileId, monthStart, monthEnd);

  // 6. Drifted targets
  const driftedTargets = await findDriftedTargets(db, tenantId, profileId, monthStart);

  // 7. Model intro (if LLM provided and not dry run)
  let intro: MonthlyIntroAnswer | null = null;
  if (llm !== undefined && !dryRun && topEvents.length > 0) {
    intro = await generateMonthlyIntro(llm, tenantId, topEvents, language);
  }

  // Stats
  const stats = await collectMonthlyStats(db, tenantId, profileId, monthStart, monthEnd);

  return {
    month,
    profileId,
    profileName: profile.name,
    language,
    topEvents,
    targetSummaries,
    priceChanges,
    hiringSummaries,
    decisions,
    driftedTargets,
    intro,
    sourcesChecked: stats.sourcesChecked,
    itemsConsidered: stats.itemsConsidered,
    generatedAt: new Date(),
  };
}

/** Load all events with facts for the profile in the given month. */
async function loadMonthlyEvents(
  db: Queryable,
  tenantId: string,
  profileId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyEventSummary[]> {
  const rows = await db
    .select({
      id: schema.events.id,
      targetId: schema.events.targetId,
      targetName: schema.watchTargets.name,
      targetKind: schema.watchTargets.kind,
      kind: schema.events.kind,
      summary: schema.events.summary,
      implication: schema.events.implication,
      interpretation: schema.events.interpretation,
      occurredAt: schema.events.occurredAt,
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
        gte(schema.events.createdAt, monthStart),
        lt(schema.events.createdAt, monthEnd),
        isNull(schema.watchTargets.pausedAt),
        sql`EXISTS (SELECT 1 FROM ${schema.facts} WHERE ${schema.facts.eventId} = ${schema.events.id})`,
      ),
    )
    .orderBy(desc(schema.events.occurredAt));

  if (rows.length === 0) return [];

  // Load facts for these events
  const eventIds = rows.map((r) => r.id);
  const facts = await db
    .select({
      eventId: schema.facts.eventId,
      statement: schema.facts.statement,
      quote: schema.facts.quote,
    })
    .from(schema.facts)
    .where(scoped(schema.facts, tenantId, inArray(schema.facts.eventId, eventIds)))
    .orderBy(schema.facts.createdAt);

  const factsByEvent = new Map<string, { statement: string; quote: string }[]>();
  for (const fact of facts) {
    const list = factsByEvent.get(fact.eventId) ?? [];
    list.push({ statement: fact.statement, quote: fact.quote });
    factsByEvent.set(fact.eventId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    targetId: row.targetId,
    targetName: row.targetName,
    targetKind: row.targetKind,
    kind: row.kind,
    summary: row.summary,
    facts: factsByEvent.get(row.id) ?? [],
    occurredAt: row.occurredAt ?? new Date(),
    sourceUrl: row.sourceUrl ? toSafeLink(row.sourceUrl) : null,
  }));
}

/** Select top 3-5 events by kind priority and cluster size (source count). */
export function selectTopEvents(
  events: MonthlyEventSummary[],
  _targets: { id: string; name: string }[],
): MonthlyEventSummary[] {
  // Group events by target to count cluster sizes
  const eventsByTarget = new Map<string, MonthlyEventSummary[]>();
  for (const event of events) {
    const key = event.targetId ?? "no-target";
    const list = eventsByTarget.get(key) ?? [];
    list.push(event);
    eventsByTarget.set(key, list);
  }

  // Score each event: kind priority + cluster size bonus
  const scored = events.map((event) => {
    const clusterSize = eventsByTarget.get(event.targetId ?? "no-target")?.length ?? 1;
    const kindPriority = EVENT_KIND_PRIORITY[event.kind ?? "other"] ?? 5;
    const score = kindPriority + Math.min(clusterSize * 5, 20); // Cap cluster bonus at 20
    return { event, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_TOP_EVENTS).map((s) => s.event);
}

/** Build per-target one-liner summaries. */
export function buildTargetSummaries(
  events: MonthlyEventSummary[],
  targets: { id: string; name: string; kind: string; pausedAt: Date | null }[],
  _monthStart: Date,
  _monthEnd: Date,
): MonthlyTargetSummary[] {
  const eventsByTarget = new Map<string, MonthlyEventSummary[]>();
  for (const event of events) {
    const key = event.targetId ?? "no-target";
    const list = eventsByTarget.get(key) ?? [];
    list.push(event);
    eventsByTarget.set(key, list);
  }

  return targets
    .filter((t) => t.pausedAt === null)
    .map((target) => {
      const targetEvents = eventsByTarget.get(target.id) ?? [];
      const eventCount = targetEvents.length;

      if (eventCount === 0) {
        return {
          targetId: target.id,
          targetName: target.name,
          targetKind: target.kind,
          eventCount: 0,
          topEventKinds: [] as string[],
          oneLiner: "quiet",
          isQuiet: true,
        };
      }

      // Count event kinds
      const kindCounts = new Map<string, number>();
      for (const e of targetEvents) {
        const kind = e.kind ?? "other";
        kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
      }
      const topEventKinds = Array.from(kindCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([kind]) => kind);

      const oneLiner = `${eventCount} event${eventCount === 1 ? "" : "s"}: ${topEventKinds.join(", ")}`;

      return {
        targetId: target.id,
        targetName: target.name,
        targetKind: target.kind,
        eventCount,
        topEventKinds,
        oneLiner,
        isQuiet: false,
      };
    });
}

/** Load price/plan changes for the month. */
async function loadMonthlyPriceChanges(
  db: Queryable,
  tenantId: string,
  profileId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyPriceChange[]> {
  const targetRows = await fetchTargetRows(db, tenantId, profileId);
  const targetIds = targetRows.map((t) => t.id);
  if (targetIds.length === 0) return [];

  const events = await fetchPricePlanEvents(
    db,
    tenantId,
    profileId,
    targetIds,
    monthStart,
    monthEnd,
  );
  if (events.length === 0) return [];

  const grouped = groupEventsByTargetAndKind(events);
  const targetNameMap = new Map(targetRows.map((t) => [t.id, t.name]));
  const changes = buildPriceChanges(grouped, targetNameMap);

  changes.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return changes;
}

async function fetchTargetRows(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.watchTargets.id, name: schema.watchTargets.name })
    .from(schema.watchTargets)
    .where(
      scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.profileId, profileId)),
    );
}

interface PricePlanEvent {
  id: string;
  targetId: string | null;
  kind: string | null;
  summary: string;
  occurredAt: Date | null;
  sourceUrl: string | null;
}

async function fetchPricePlanEvents(
  db: Queryable,
  tenantId: string,
  profileId: string,
  targetIds: string[],
  monthStart: Date,
  monthEnd: Date,
): Promise<PricePlanEvent[]> {
  return db
    .select({
      id: schema.events.id,
      targetId: schema.events.targetId,
      kind: schema.events.kind,
      summary: schema.events.summary,
      occurredAt: schema.events.occurredAt,
      sourceUrl: schema.rawItems.url,
    })
    .from(schema.events)
    .innerJoin(schema.rawItems, eq(schema.rawItems.id, schema.events.rawItemId))
    .where(
      scoped(
        schema.events,
        tenantId,
        eq(schema.events.profileId, profileId),
        inArray(schema.events.targetId, targetIds),
        gte(schema.events.occurredAt, monthStart),
        lt(schema.events.occurredAt, monthEnd),
        sql`${schema.events.kind} IN ('price', 'plan')`,
      ),
    )
    .orderBy(schema.events.targetId, schema.events.occurredAt);
}

function groupEventsByTargetAndKind(events: PricePlanEvent[]): Map<string, PricePlanEvent[]> {
  const byTargetKind = new Map<string, PricePlanEvent[]>();
  for (const event of events) {
    const key = `${event.targetId}:${event.kind}`;
    const list = byTargetKind.get(key) ?? [];
    list.push(event);
    byTargetKind.set(key, list);
  }
  return byTargetKind;
}

function buildPriceChanges(
  grouped: Map<string, PricePlanEvent[]>,
  targetNameMap: Map<string, string>,
): MonthlyPriceChange[] {
  const changes: MonthlyPriceChange[] = [];

  for (const [, group] of grouped) {
    if (group.length === 1) {
      const e = group[0];
      if (e !== undefined) {
        changes.push(buildPriceChange(e, null, targetNameMap));
      }
    } else {
      for (let i = 1; i < group.length; i++) {
        const prev = group[i - 1];
        const curr = group[i];
        if (prev !== undefined && curr !== undefined) {
          changes.push(buildPriceChange(curr, prev.summary, targetNameMap));
        }
      }
    }
  }

  return changes;
}

function buildPriceChange(
  event: PricePlanEvent,
  was: string | null,
  targetNameMap: Map<string, string>,
): MonthlyPriceChange {
  return {
    targetId: event.targetId ?? "",
    targetName: targetNameMap.get(event.targetId ?? "") ?? "Unknown",
    occurredAt: event.occurredAt ?? new Date(),
    kind: event.kind as "price" | "plan",
    was,
    became: event.summary,
    quote: null,
    sourceUrl: event.sourceUrl ? toSafeLink(event.sourceUrl) : null,
  };
}

/** Load hiring data for the month. */
async function loadMonthlyHiring(
  db: Queryable,
  tenantId: string,
  profileId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyHiringSummary[]> {
  const targetRows = await fetchTargetRows(db, tenantId, profileId);
  const targetIds = targetRows.map((t) => t.id);
  if (targetIds.length === 0) return [];

  const atsSources = await fetchAtsSources(db, tenantId, targetIds);
  const sourceIds = atsSources.map((s) => s.id);
  if (sourceIds.length === 0) return [];

  const latestItems = await fetchLatestJobItems(db, tenantId, sourceIds, monthStart, monthEnd);
  const previousItems = await fetchPreviousJobItems(db, tenantId, sourceIds, monthStart);

  const currentBySource = buildCurrentBySource(latestItems);
  const previousTitlesBySource = buildPreviousTitlesBySource(previousItems);

  const targetNameMap = new Map(targetRows.map((t) => [t.id, t.name]));
  const sourceToTarget = new Map(atsSources.map((s) => [s.id, s.targetId]));

  const hiringByTarget = buildHiringByTarget(
    currentBySource,
    previousTitlesBySource,
    sourceToTarget,
    targetNameMap,
  );

  return Array.from(hiringByTarget.values()).sort((a, b) => b.openCount - a.openCount);
}

async function fetchAtsSources(
  db: Queryable,
  tenantId: string,
  targetIds: string[],
): Promise<{ id: string; targetId: string | null }[]> {
  return db
    .select({ id: schema.sources.id, targetId: schema.sources.targetId })
    .from(schema.sources)
    .where(
      scopedAlive(
        schema.sources,
        tenantId,
        inArray(schema.sources.targetId, targetIds),
        eq(schema.sources.kind, "json"),
      ),
    );
}

interface JobItem {
  sourceId: string;
  content: string;
  fetchedAt: Date;
  url: string | null;
}

async function fetchLatestJobItems(
  db: Queryable,
  tenantId: string,
  sourceIds: string[],
  monthStart: Date,
  monthEnd: Date,
): Promise<JobItem[]> {
  return db
    .selectDistinctOn([schema.rawItems.sourceId], {
      sourceId: schema.rawItems.sourceId,
      content: schema.rawItems.content,
      fetchedAt: schema.rawItems.fetchedAt,
      url: schema.rawItems.url,
    })
    .from(schema.rawItems)
    .where(
      scoped(
        schema.rawItems,
        tenantId,
        inArray(schema.rawItems.sourceId, sourceIds),
        eq(schema.rawItems.kind, "job"),
        gte(schema.rawItems.fetchedAt, monthStart),
        lt(schema.rawItems.fetchedAt, monthEnd),
      ),
    )
    .orderBy(schema.rawItems.sourceId, desc(schema.rawItems.fetchedAt));
}

async function fetchPreviousJobItems(
  db: Queryable,
  tenantId: string,
  sourceIds: string[],
  monthStart: Date,
): Promise<Omit<JobItem, "url">[]> {
  return db
    .select({
      sourceId: schema.rawItems.sourceId,
      content: schema.rawItems.content,
      fetchedAt: schema.rawItems.fetchedAt,
    })
    .from(schema.rawItems)
    .where(
      scoped(
        schema.rawItems,
        tenantId,
        inArray(schema.rawItems.sourceId, sourceIds),
        eq(schema.rawItems.kind, "job"),
        lt(schema.rawItems.fetchedAt, monthStart),
      ),
    )
    .orderBy(schema.rawItems.sourceId, desc(schema.rawItems.fetchedAt));
}

function buildCurrentBySource(items: JobItem[]): Map<string, JobItem> {
  const currentBySource = new Map<string, JobItem>();
  for (const item of items) {
    if (!currentBySource.has(item.sourceId)) {
      currentBySource.set(item.sourceId, item);
    }
  }
  return currentBySource;
}

function buildPreviousTitlesBySource(items: Omit<JobItem, "url">[]): Map<string, Set<string>> {
  const previousTitlesBySource = new Map<string, Set<string>>();
  for (const item of items) {
    try {
      const jobs = JSON.parse(item.content) as Array<{ title: string }>;
      const titles = new Set(jobs.map((j) => j.title.toLowerCase()));
      previousTitlesBySource.set(item.sourceId, titles);
    } catch {
      // Ignore invalid JSON
    }
  }
  return previousTitlesBySource;
}

interface ParsedJob {
  title: string;
  department?: string;
}

function parseJobs(content: string): ParsedJob[] | null {
  try {
    return JSON.parse(content) as ParsedJob[];
  } catch {
    return null;
  }
}

function buildHiringByTarget(
  currentBySource: Map<string, JobItem>,
  previousTitlesBySource: Map<string, Set<string>>,
  sourceToTarget: Map<string, string | null>,
  targetNameMap: Map<string, string>,
): Map<string, MonthlyHiringSummary> {
  const hiringByTarget = new Map<string, MonthlyHiringSummary>();

  for (const [sourceId, item] of currentBySource) {
    const targetId = sourceToTarget.get(sourceId);
    if (!targetId) continue;

    const jobs = parseJobs(item.content);
    if (!jobs) continue;

    const sourceHiring = computeSourceHiring(
      jobs,
      previousTitlesBySource.get(sourceId) ?? new Set(),
    );
    mergeHiringIntoTarget(hiringByTarget, targetId, targetNameMap, sourceHiring);
  }

  return hiringByTarget;
}

interface SourceHiring {
  openCount: number;
  newThisMonth: number;
  departments: Set<string>;
}

function computeSourceHiring(jobs: ParsedJob[], previousTitles: Set<string>): SourceHiring {
  let newThisMonth = 0;
  const departments = new Set<string>();

  for (const job of jobs) {
    departments.add(job.department ?? "General");
    if (!previousTitles.has(job.title.toLowerCase())) {
      newThisMonth++;
    }
  }

  return {
    openCount: jobs.length,
    newThisMonth,
    departments,
  };
}

function mergeHiringIntoTarget(
  hiringByTarget: Map<string, MonthlyHiringSummary>,
  targetId: string,
  targetNameMap: Map<string, string>,
  sourceHiring: SourceHiring,
): void {
  const existing = hiringByTarget.get(targetId);
  if (existing === undefined) {
    hiringByTarget.set(targetId, {
      targetId,
      targetName: targetNameMap.get(targetId) ?? "Unknown",
      openCount: sourceHiring.openCount,
      newThisMonth: sourceHiring.newThisMonth,
      departments: Array.from(sourceHiring.departments),
    });
  } else {
    hiringByTarget.set(targetId, {
      ...existing,
      openCount: existing.openCount + sourceHiring.openCount,
      newThisMonth: existing.newThisMonth + sourceHiring.newThisMonth,
      departments: Array.from(new Set([...existing.departments, ...sourceHiring.departments])),
    });
  }
}

/** Load user decisions for the month (count + IDs only). */
async function loadMonthlyDecisions(
  db: Queryable,
  tenantId: string,
  profileId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyDecisionSummary> {
  const rows = await db
    .select({ id: schema.decisions.id })
    .from(schema.decisions)
    .where(
      scoped(
        schema.decisions,
        tenantId,
        eq(schema.decisions.profileId, profileId),
        gte(schema.decisions.createdAt, monthStart),
        lt(schema.decisions.createdAt, monthEnd),
      ),
    );

  return {
    count: rows.length,
    decisionIds: rows.map((r) => r.id),
  };
}

/** Find targets with no events or reactions for 60+ days. */
async function findDriftedTargets(
  db: Queryable,
  tenantId: string,
  profileId: string,
  monthStart: Date,
): Promise<MonthlyDriftedTarget[]> {
  const cutoff = new Date(monthStart.getTime() - DRIFT_SILENCE_DAYS * 24 * 60 * 60 * 1000);

  const targets = await db
    .select({
      id: schema.watchTargets.id,
      name: schema.watchTargets.name,
      kind: schema.watchTargets.kind,
    })
    .from(schema.watchTargets)
    .where(
      scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.profileId, profileId)),
    );

  const drifted: MonthlyDriftedTarget[] = [];

  for (const target of targets) {
    // Last event for this target
    const [lastEvent] = await db
      .select({ occurredAt: schema.events.occurredAt })
      .from(schema.events)
      .where(
        scoped(
          schema.events,
          tenantId,
          eq(schema.events.targetId, target.id),
          isNotNull(schema.events.occurredAt),
        ),
      )
      .orderBy(desc(schema.events.occurredAt))
      .limit(1);

    // Last user reaction (any action) for events of this target
    const [lastReaction] = await db
      .select({ occurredAt: schema.userActions.occurredAt })
      .from(schema.userActions)
      .innerJoin(schema.events, eq(schema.events.id, schema.userActions.eventId))
      .where(scoped(schema.userActions, tenantId, eq(schema.events.targetId, target.id)))
      .orderBy(desc(schema.userActions.occurredAt))
      .limit(1);

    const lastEventAt = lastEvent?.occurredAt ?? null;
    const lastReactionAt = lastReaction?.occurredAt ?? null;

    const lastActivityAt =
      [lastEventAt, lastReactionAt]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    if (lastActivityAt === null || lastActivityAt < cutoff) {
      const daysSince = lastActivityAt
        ? Math.floor((monthStart.getTime() - lastActivityAt.getTime()) / (24 * 60 * 60 * 1000))
        : DRIFT_SILENCE_DAYS + 1;

      drifted.push({
        targetId: target.id,
        targetName: target.name,
        targetKind: target.kind,
        lastEventAt,
        lastReactionAt,
        daysSinceActivity: daysSince,
      });
    }
  }

  return drifted.sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);
}

/** Collect stats for the monthly report. */
async function collectMonthlyStats(
  db: Queryable,
  tenantId: string,
  profileId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<{ sourcesChecked: number; itemsConsidered: number }> {
  const [sources] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.sources)
    .where(
      scopedAlive(
        schema.sources,
        tenantId,
        eq(schema.sources.profileId, profileId),
        gte(schema.sources.lastPolledAt, monthStart),
        lt(schema.sources.lastPolledAt, monthEnd),
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
        gte(schema.rawItems.fetchedAt, monthStart),
        lt(schema.rawItems.fetchedAt, monthEnd),
      ),
    );

  return {
    sourcesChecked: sources?.total ?? 0,
    itemsConsidered: items?.total ?? 0,
  };
}

/** Generate the 2-3 sentence intro using the expensive model. */
async function generateMonthlyIntro(
  llm: LlmClient,
  tenantId: string,
  topEvents: MonthlyEventSummary[],
  language: "en" | "ru",
): Promise<MonthlyIntroAnswer | null> {
  const eventSummaries = topEvents
    .map((e, i) => {
      const factsText = e.facts.map((f) => `- ${f.statement} («${f.quote}»)`).join("\n");
      return `[${i + 1}] Event ${e.id} (${e.targetName ?? "general"}, ${e.kind ?? "other"}): ${e.summary}\n${factsText}`;
    })
    .join("\n\n");

  const systemPrompt = [
    `You write a brief executive summary for a business owner's monthly market report.`,
    `Language: ${language === "ru" ? "Russian" : "English"}.`,
    "",
    "Input: a list of the month's most significant events, each with verified facts and quotes.",
    "Output: 2–3 sentences. Each sentence MUST reference one or more event IDs from the input",
    "using the format [1], [2], etc. (the numbers in brackets before each event).",
    "Do not invent facts. Do not give advice. Do not use directives.",
    "If you cannot write a grounded summary, return an empty sentences array.",
  ].join("\n");

  const material = `Top events this month:\n\n${eventSummaries}`;

  try {
    const { value } = await llm.complete({
      tier: "deep",
      system: systemPrompt,
      material,
      schema: monthlyIntroSchema,
      purpose: "monthly_intro",
      tenantId,
      temperature: 0.2,
      maxOutputTokens: 800,
    });

    // Validate that all referenced event IDs exist in the input
    const validEventIds = new Set(topEvents.map((e) => e.id));
    for (const sentence of value.sentences) {
      for (const eventId of sentence.eventIds) {
        if (!validEventIds.has(eventId)) {
          // Invalid reference — discard the entire intro
          return null;
        }
      }
    }

    return value;
  } catch {
    // Model failed or output invalid — report goes out without intro
    return null;
  }
}

/** Persist the monthly report as a digest with kind='monthly'. */
export async function persistMonthlyReport(
  db: Queryable,
  tenantId: string,
  profileId: string,
  report: MonthlyReportData,
): Promise<string> {
  const digestId = uuidv7();
  const now = new Date();

  // Calculate period start/end from month key
  const [yearStr, monthStr] = report.month.split("-") as [string, string];
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const periodStart = new Date(Date.UTC(year, monthIndex, 1));
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

  // Get current profile version
  const [profile] = await db
    .select({ currentVersionId: schema.watchProfiles.currentVersionId })
    .from(schema.watchProfiles)
    .where(scoped(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);

  if (profile?.currentVersionId === null || profile?.currentVersionId === undefined) {
    throw new AppError("not_found", "Profile has no version.");
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.digests).values({
      id: digestId,
      tenantId,
      profileId,
      profileVersionId: profile.currentVersionId,
      periodStart,
      periodEnd,
      channel: "web_only",
      status: "delivered",
      deliveredAt: now,
      sourcesChecked: report.sourcesChecked,
      itemsConsidered: report.itemsConsidered,
      nearMisses: [],
      notices: [],
    } as typeof schema.digests.$inferInsert);

    // Store the full report data in a notice-like structure or as cards
    // For now, we store it as a special card with the report JSON
    const cardId = uuidv7();
    await tx.insert(schema.digestCards).values({
      id: cardId,
      tenantId,
      digestId,
      eventId: report.topEvents[0]?.id ?? uuidv7(), // placeholder
      position: 0,
      kind: "group",
      headline: "Monthly Market Report",
      sourceUrl: null,
      ageDays: null,
      moreCount: 0,
    });

    // Store report data as a special block
    await tx.insert(schema.cardBlocks).values({
      id: uuidv7(),
      tenantId,
      cardId,
      kind: "analyst_opinion", // reuse kind for structured data
      position: 0,
      content: JSON.stringify({
        type: "monthly_report",
        month: report.month,
        topEvents: report.topEvents.map((e) => ({
          id: e.id,
          targetName: e.targetName,
          kind: e.kind,
          summary: e.summary,
          occurredAt: e.occurredAt.toISOString(),
          sourceUrl: e.sourceUrl,
        })),
        targetSummaries: report.targetSummaries,
        priceChanges: report.priceChanges.map((p) => ({
          ...p,
          occurredAt: p.occurredAt.toISOString(),
        })),
        hiringSummaries: report.hiringSummaries,
        decisions: report.decisions,
        driftedTargets: report.driftedTargets.map((d) => ({
          ...d,
          lastEventAt: d.lastEventAt?.toISOString() ?? null,
          lastReactionAt: d.lastReactionAt?.toISOString() ?? null,
        })),
        intro: report.intro,
      }),
      quote: null,
      sourceUrl: null,
    });
  });

  return digestId;
}
