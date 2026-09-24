/**
 * Selection: which of a profile's new material becomes an event.
 *
 * The cascade, in the order AGENTS.md fixes:
 *
 * 1. **Stopwords** on the title — free, and the person's own explicit "no".
 * 2. **Cosine** of the item's best chunk to the profile — free, local, wide.
 * 3. **The cheap model**, on at most forty items per profile per day, best
 *    cosine first. Everything past the budget waits for tomorrow rather than
 *    being rejected, so a busy day delays material instead of losing it.
 *
 * Every item that stops at a step leaves a rejection with its reason, which is
 * what the digest's "closest misses" line and the dry run's `--explain` read.
 * An item that passes becomes an event with no facts yet: extraction writes
 * those, on the far smaller set that got this far.
 */

import { type Logger, toAppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import type { EmbeddingProvider } from "@mifluent/embeddings";
import type { LlmClient } from "@mifluent/llm";
import { and, eq, gte, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { CostGuard } from "../guard.js";
import { loadProfileVectors, type ProfileContext, type ProfileVector } from "../profile.js";
import {
  buildMaterialityPrompt,
  buildRelevancePrompt,
  formatMaterial,
  type MaterialityAnswer,
  materialitySchema,
  PROMPT_VERSION,
  type RelevanceAnswer,
  relevanceSchema,
} from "../prompts/selection.js";
import { cosineCutoff, findStopword, scoreItem } from "./score.js";

export interface SelectionOptions {
  readonly db: Queryable;
  readonly context: ProfileContext;
  readonly provider: EmbeddingProvider;
  /** Absent in `--no-llm` dry runs: the run stops after the cosine step. */
  readonly llm: LlmClient | undefined;
  readonly guard: CostGuard;
  readonly logger: Logger;
  readonly now?: Date | undefined;
  /** Look at material fetched since this moment instead of the default two weeks. */
  readonly since?: Date | undefined;
}

export interface SelectionDecision {
  readonly rawItemId: string;
  readonly title: string | null;
  readonly score: number;
  readonly outcome: "event" | "stopword" | "below_cosine" | "model_rejected" | "deferred";
  readonly detail: string | null;
  readonly eventId: string | null;
  readonly nearestTargetId: string | null;
}

export interface SelectionResult {
  readonly status: "completed" | "skipped_cost_cap" | "model_unavailable";
  readonly considered: number;
  readonly keptByCosine: number;
  readonly modelCalls: number;
  readonly eventsCreated: number;
  readonly decisions: readonly SelectionDecision[];
}

interface Candidate {
  readonly id: string;
  readonly title: string | null;
  readonly content: string;
  readonly kind: string;
  readonly publishedAt: Date | null;
  readonly fetchedAt: Date;
  readonly sourceTargetId: string | null;
}

interface Scored extends Candidate {
  readonly score: number;
  readonly nearestTargetId: string | null;
}

/** From TASK-007: the cheap model sees at most this many items per profile per day. */
export const MAX_MODEL_CALLS_PER_DAY = 40;

/**
 * Rejections are pruned after fourteen days, so an item older than that would
 * look unjudged again. Material older than two weeks is not news either.
 */
const SELECTION_WINDOW_DAYS = 14;

/** A bound on one run's memory; the rest waits for the next run. */
const MAX_CANDIDATES_PER_RUN = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function selectForProfile(options: SelectionOptions): Promise<SelectionResult> {
  const { db, context } = options;
  const now = options.now ?? new Date();

  const candidates = await findCandidates(db, context, options.since ?? defaultSince(now));
  const decisions: SelectionDecision[] = [];

  if (candidates.length === 0) {
    return summarise("completed", 0, 0, decisions);
  }

  const profileVectors = await loadProfileVectors(db, context, options.provider);
  const vectors = await loadChunkVectors(db, context.tenantId, options.provider.model, candidates);
  const cutoff = cosineCutoff(context.relevanceThreshold);

  const survivors: Scored[] = [];
  for (const candidate of candidates) {
    const decision = await applyFreeSteps(db, {
      context,
      candidate,
      chunkVectors: vectors.get(candidate.id) ?? [],
      profileVectors,
      cutoff,
    });
    if ("outcome" in decision) decisions.push(decision);
    else survivors.push(decision);
  }

  survivors.sort((left, right) => right.score - left.score);

  if (options.llm === undefined) {
    decisions.push(...survivors.map((item) => deferred(item, "stopped before the model step")));
    return summarise("completed", candidates.length, survivors.length, decisions);
  }

  const budget = MAX_MODEL_CALLS_PER_DAY - (await countModelDecisionsToday(db, context, now));
  const status = await judgeWithModel(
    { ...options, llm: options.llm, now },
    survivors,
    budget,
    decisions,
  );
  const result = summarise(status, candidates.length, survivors.length, decisions);

  options.logger.info("pipeline.selected", {
    tenantId: context.tenantId,
    profileId: context.profileId,
    promptVersion: PROMPT_VERSION,
    status,
    considered: result.considered,
    keptByCosine: result.keptByCosine,
    modelCalls: result.modelCalls,
    eventsCreated: result.eventsCreated,
  });

  return result;
}

interface FreeStepInput {
  readonly context: ProfileContext;
  readonly candidate: Candidate;
  readonly chunkVectors: readonly (readonly number[])[];
  readonly profileVectors: readonly ProfileVector[];
  readonly cutoff: number;
}

async function applyFreeSteps(
  db: Queryable,
  input: FreeStepInput,
): Promise<SelectionDecision | Scored> {
  const { context, candidate } = input;
  const { score, nearestTargetId } = scoreItem(input.chunkVectors, input.profileVectors);

  const stopword = findStopword(candidate.title, context.stopwords);
  if (stopword !== null) {
    await reject(db, {
      context,
      itemId: candidate.id,
      reason: "stopword",
      score,
      detail: stopword,
    });
    return { ...decision(candidate, score, "stopword", stopword), nearestTargetId };
  }

  if (score < input.cutoff) {
    await reject(db, {
      context,
      itemId: candidate.id,
      reason: "below_cosine",
      score,
      detail: null,
    });
    return { ...decision(candidate, score, "below_cosine", null), nearestTargetId };
  }

  return { ...candidate, score, nearestTargetId };
}

interface JudgeOptions extends SelectionOptions {
  readonly llm: LlmClient;
  readonly now: Date;
}

async function judgeWithModel(
  options: JudgeOptions,
  survivors: readonly Scored[],
  budget: number,
  decisions: SelectionDecision[],
): Promise<SelectionResult["status"]> {
  for (const [index, item] of survivors.entries()) {
    if (index >= budget) {
      decisions.push(deferred(item, "daily model budget for this profile is used up"));
      continue;
    }

    if (await options.guard()) {
      decisions.push(...survivors.slice(index).map((rest) => deferred(rest, "cost cap reached")));
      return "skipped_cost_cap";
    }

    try {
      decisions.push(await judgeOne(options, item));
    } catch (thrown) {
      const error = toAppError(thrown);
      if (error.code === "model_response_invalid") {
        await reject(options.db, {
          context: options.context,
          itemId: item.id,
          reason: "model_rejected",
          score: item.score,
          detail: "The model could not give a usable answer about this item.",
        });
        decisions.push(decision(item, item.score, "model_rejected", "unusable model answer"));
        continue;
      }
      // Rate limits and outages will not clear by the next item. Stop, and
      // leave the rest for the next run rather than burning through them.
      options.logger.warn("pipeline.selection_interrupted", {
        profileId: options.context.profileId,
        code: error.code,
      });
      decisions.push(...survivors.slice(index).map((rest) => deferred(rest, error.message)));
      return "model_unavailable";
    }
  }

  return "completed";
}

async function judgeOne(options: JudgeOptions, item: Scored): Promise<SelectionDecision> {
  const { db, context, llm } = options;
  const material = formatMaterial({ title: item.title, content: item.content });

  if (item.kind === "diff" || item.kind === "job") {
    const { value } = await llm.complete({
      tier: "cheap",
      system: buildMaterialityPrompt(context, item.kind),
      material,
      schema: materialitySchema,
      purpose: "selection",
      tenantId: context.tenantId,
      temperature: 0,
    });
    return recordMateriality(db, { context, item, answer: value });
  }

  const { value } = await llm.complete({
    tier: "cheap",
    system: buildRelevancePrompt(context),
    material,
    schema: relevanceSchema,
    purpose: "selection",
    tenantId: context.tenantId,
    temperature: 0,
  });
  return recordRelevance(db, { context, item, answer: value });
}

async function recordRelevance(
  db: Queryable,
  input: { context: ProfileContext; item: Scored; answer: RelevanceAnswer },
): Promise<SelectionDecision> {
  const { context, item, answer } = input;

  if (!answer.relevant) {
    await reject(db, {
      context,
      itemId: item.id,
      reason: "model_rejected",
      score: item.score,
      detail: answer.reason,
    });
    return decision(item, item.score, "model_rejected", answer.reason);
  }

  const eventId = await createEvent(db, {
    context,
    item,
    // The model's target must be one the profile actually has; an id it made
    // up, or one planted by the material, is discarded.
    targetId: pickTarget(context, answer.targetId, item),
    summary: item.title ?? answer.reason,
    kind: item.kind === "release" ? "feature" : "news",
    isUrgent: false,
  });
  return { ...decision(item, item.score, "event", answer.reason), eventId };
}

async function recordMateriality(
  db: Queryable,
  input: { context: ProfileContext; item: Scored; answer: MaterialityAnswer },
): Promise<SelectionDecision> {
  const { context, item, answer } = input;

  if (!answer.material || answer.kind === "cosmetic") {
    await reject(db, {
      context,
      itemId: item.id,
      reason: "model_rejected",
      score: item.score,
      detail: answer.summary,
    });
    return decision(item, item.score, "model_rejected", answer.summary);
  }

  const eventId = await createEvent(db, {
    context,
    item,
    targetId: pickTarget(context, item.sourceTargetId, item),
    summary: answer.summary,
    kind: answer.kind,
    isUrgent: answer.urgent,
  });
  return { ...decision(item, item.score, "event", answer.summary), eventId };
}

/** A claimed target if it is real, else the source's own target, else the nearest by cosine. */
export function pickTarget(
  context: ProfileContext,
  claimed: string | null,
  item: { readonly sourceTargetId: string | null; readonly nearestTargetId: string | null },
): string | null {
  const known = new Set(context.targets.map((target) => target.id));
  for (const candidate of [claimed, item.sourceTargetId, item.nearestTargetId]) {
    if (candidate !== null && known.has(candidate)) return candidate;
  }
  return null;
}

interface NewEvent {
  readonly context: ProfileContext;
  readonly item: Scored;
  readonly targetId: string | null;
  readonly summary: string;
  readonly kind: string;
  readonly isUrgent: boolean;
}

async function createEvent(db: Queryable, event: NewEvent): Promise<string> {
  const { context, item } = event;
  const eventId = uuidv7();

  await db.transaction(async (transaction) => {
    await transaction.insert(schema.events).values({
      id: eventId,
      tenantId: context.tenantId,
      profileId: context.profileId,
      profileVersionId: context.versionId,
      rawItemId: item.id,
      targetId: event.targetId,
      relevanceScore: item.score,
      summary: event.summary.slice(0, 500),
      kind: event.kind,
      isUrgent: event.isUrgent,
      occurredAt: item.publishedAt ?? item.fetchedAt,
    });
    await transaction.insert(schema.eventItems).values({
      id: uuidv7(),
      tenantId: context.tenantId,
      eventId,
      rawItemId: item.id,
      isPrimary: true,
    });
  });

  return eventId;
}

interface Rejection {
  readonly context: ProfileContext;
  readonly itemId: string;
  readonly reason: "stopword" | "below_cosine" | "model_rejected";
  readonly score: number;
  readonly detail: string | null;
}

async function reject(db: Queryable, rejection: Rejection): Promise<void> {
  await db.insert(schema.rejections).values({
    id: uuidv7(),
    tenantId: rejection.context.tenantId,
    profileId: rejection.context.profileId,
    rawItemId: rejection.itemId,
    reason: rejection.reason,
    detail: rejection.detail?.slice(0, 500) ?? null,
    score: clampScore(rejection.score).toFixed(3),
  });
}

/**
 * Material from this profile's sources that has chunks and no verdict yet.
 *
 * "No verdict" is the absence of both an event link and a rejection for this
 * profile, rather than a flag on the item: the same item can belong to two
 * profiles' sources and deserve different answers.
 */
function defaultSince(now: Date): Date {
  return new Date(now.getTime() - SELECTION_WINDOW_DAYS * DAY_MS);
}

async function findCandidates(
  db: Queryable,
  context: ProfileContext,
  since: Date,
): Promise<Candidate[]> {
  return db
    .select({
      id: schema.rawItems.id,
      title: schema.rawItems.title,
      content: schema.rawItems.content,
      kind: schema.rawItems.kind,
      publishedAt: schema.rawItems.publishedAt,
      fetchedAt: schema.rawItems.fetchedAt,
      sourceTargetId: schema.sources.targetId,
    })
    .from(schema.rawItems)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.rawItems.sourceId))
    .where(
      scoped(
        schema.rawItems,
        context.tenantId,
        eq(schema.sources.profileId, context.profileId),
        isNull(schema.sources.deletedAt),
        gte(schema.rawItems.fetchedAt, since),
        sql`EXISTS (SELECT 1 FROM ${schema.chunks} WHERE ${schema.chunks.rawItemId} = ${schema.rawItems.id})`,
        notExists(
          db
            .select({ id: schema.eventItems.id })
            .from(schema.eventItems)
            .innerJoin(schema.events, eq(schema.events.id, schema.eventItems.eventId))
            .where(
              and(
                eq(schema.eventItems.rawItemId, schema.rawItems.id),
                eq(schema.events.profileId, context.profileId),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: schema.rejections.id })
            .from(schema.rejections)
            .where(
              and(
                eq(schema.rejections.rawItemId, schema.rawItems.id),
                eq(schema.rejections.profileId, context.profileId),
              ),
            ),
        ),
      ),
    )
    .orderBy(schema.rawItems.fetchedAt)
    .limit(MAX_CANDIDATES_PER_RUN);
}

async function loadChunkVectors(
  db: Queryable,
  tenantId: string,
  model: string,
  candidates: readonly Candidate[],
): Promise<Map<string, number[][]>> {
  const rows = await db
    .select({ itemId: schema.chunks.rawItemId, vector: schema.embeddings.embedding })
    .from(schema.chunks)
    .innerJoin(schema.embeddings, eq(schema.embeddings.chunkId, schema.chunks.id))
    .where(
      scoped(
        schema.chunks,
        tenantId,
        eq(schema.embeddings.model, model),
        inArray(
          schema.chunks.rawItemId,
          candidates.map((candidate) => candidate.id),
        ),
      ),
    );

  const byItem = new Map<string, number[][]>();
  for (const row of rows) {
    byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.vector]);
  }
  return byItem;
}

/** Model verdicts already spent today on this profile: events plus model rejections. */
async function countModelDecisionsToday(
  db: Queryable,
  context: ProfileContext,
  now: Date,
): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [events] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.events)
    .where(
      scoped(
        schema.events,
        context.tenantId,
        eq(schema.events.profileId, context.profileId),
        gte(schema.events.createdAt, dayStart),
      ),
    );

  const [rejected] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.rejections)
    .where(
      scoped(
        schema.rejections,
        context.tenantId,
        eq(schema.rejections.profileId, context.profileId),
        eq(schema.rejections.reason, "model_rejected"),
        gte(schema.rejections.occurredAt, dayStart),
      ),
    );

  return (events?.total ?? 0) + (rejected?.total ?? 0);
}

function decision(
  item: Candidate & { readonly nearestTargetId?: string | null },
  score: number,
  outcome: SelectionDecision["outcome"],
  detail: string | null,
): SelectionDecision {
  return {
    rawItemId: item.id,
    title: item.title,
    score,
    outcome,
    detail,
    eventId: null,
    nearestTargetId: item.nearestTargetId ?? null,
  };
}

function deferred(item: Scored, why: string): SelectionDecision {
  return decision(item, item.score, "deferred", why);
}

function summarise(
  status: SelectionResult["status"],
  considered: number,
  keptByCosine: number,
  decisions: readonly SelectionDecision[],
): SelectionResult {
  return {
    status,
    considered,
    keptByCosine,
    modelCalls: decisions.filter(
      (item) => item.outcome === "event" || item.outcome === "model_rejected",
    ).length,
    eventsCreated: decisions.filter((item) => item.outcome === "event").length,
    decisions,
  };
}

/** `numeric(4, 3)` holds −9.999…9.999; cosine never leaves [−1, 1], but a bug should not crash a write. */
function clampScore(score: number): number {
  return Math.min(1, Math.max(-1, score));
}
