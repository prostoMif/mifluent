/**
 * Extraction: turning a selected event into facts a person can check.
 *
 * For each event that selection created and nothing has written up yet:
 *
 * 1. **Cluster** it with the profile's recent events. A reprint joins the
 *    story it belongs to and costs nothing further.
 * 2. **Extract** facts. For a page diff the added lines are the facts — the
 *    change is its own quote, and a model would only paraphrase it. Everything
 *    else goes to the expensive model once.
 * 3. **Verify** every quote against the stored text. A fact whose quote is not
 *    there is dropped; an event left with no facts is deleted and recorded as a
 *    rejection, so it is visible rather than silently gone.
 */

import { type Logger, toAppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import type { LlmClient } from "@mifluent/llm";
import { asc, eq, gte, notExists } from "drizzle-orm";
import type { CostGuard } from "../guard.js";
import type { ProfileContext } from "../profile.js";
import {
  buildExtractionPrompt,
  EXTRACTION_PROMPT_VERSION,
  extractionSchema,
  formatExtractionMaterial,
  hasStructuralFacts,
} from "../prompts/extraction.js";
import { clusterEvent } from "./cluster.js";
import { findDirective } from "./directives.js";
import { findQuote, MIN_QUOTE_LENGTH } from "./quote.js";

export interface ExtractionOptions {
  readonly db: Queryable;
  readonly context: ProfileContext;
  readonly llm: LlmClient;
  readonly guard: CostGuard;
  readonly logger: Logger;
  readonly embeddingModel: string;
  readonly clusterThreshold: number;
  readonly now?: Date | undefined;
}

export interface VerifiedFact {
  readonly statement: string;
  readonly quote: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface EventOutcome {
  readonly eventId: string;
  readonly rawItemId: string;
  readonly outcome: "extracted" | "merged" | "no_verified_quote" | "failed";
  readonly factsKept: number;
  readonly factsDropped: number;
  readonly droppedQuotes: readonly string[];
  readonly mergedInto: string | null;
  readonly isUrgent: boolean;
}

export interface ExtractionResult {
  readonly status: "completed" | "skipped_cost_cap" | "model_unavailable";
  readonly outcomes: readonly EventOutcome[];
}

interface PendingEvent {
  readonly id: string;
  readonly rawItemId: string;
  readonly isUrgent: boolean;
  readonly relevanceScore: number;
  readonly createdAt: Date;
  readonly title: string | null;
  readonly content: string;
  readonly kind: string;
  readonly addedText: string | null;
  readonly removedText: string | null;
}

/** An event not written up within a week is stale; it is left, not retried forever. */
const PENDING_WINDOW_DAYS = 7;

/** One run's worth. Selection produces at most forty a day per profile. */
const MAX_EVENTS_PER_RUN = 50;

const MAX_FACTS = 3;

export async function extractForProfile(options: ExtractionOptions): Promise<ExtractionResult> {
  const now = options.now ?? new Date();
  const pending = await findPendingEvents(options.db, options.context, now);
  const outcomes: EventOutcome[] = [];

  for (const event of pending) {
    const merged = await clusterEvent({
      db: options.db,
      tenantId: options.context.tenantId,
      profileId: options.context.profileId,
      eventId: event.id,
      rawItemId: event.rawItemId,
      isUrgent: event.isUrgent,
      createdAt: event.createdAt,
      model: options.embeddingModel,
      threshold: options.clusterThreshold,
    });

    if (merged !== null) {
      outcomes.push(outcome(event, "merged", { mergedInto: merged.anchorId }));
      continue;
    }

    if (event.kind === "diff") {
      outcomes.push(await writeUp(options, event, factsFromDiff(event), null));
      continue;
    }

    if (await options.guard()) {
      return { status: "skipped_cost_cap", outcomes };
    }

    try {
      outcomes.push(await extractWithModel(options, event));
    } catch (thrown) {
      const error = toAppError(thrown);
      options.logger.warn("pipeline.extraction_failed", {
        eventId: event.id,
        code: error.code,
      });
      if (error.code !== "model_response_invalid") {
        return { status: "model_unavailable", outcomes };
      }
      // Two unusable answers already (the adapter retried once). Asking again
      // on every run would spend the expensive model on the same item all
      // week; it is set aside with its reason instead.
      await dropEvent(options.db, options.context, event, {
        reason: "model_rejected",
        detail: "The model could not write this item up.",
      });
      outcomes.push(outcome(event, "failed", {}));
    }
  }

  options.logger.info("pipeline.extracted", {
    tenantId: options.context.tenantId,
    profileId: options.context.profileId,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    events: outcomes.length,
    extracted: outcomes.filter((item) => item.outcome === "extracted").length,
    merged: outcomes.filter((item) => item.outcome === "merged").length,
    dropped: outcomes.filter((item) => item.outcome === "no_verified_quote").length,
  });

  return { status: "completed", outcomes };
}

interface Draft {
  readonly summary: string | null;
  readonly facts: readonly { readonly statement: string; readonly quote: string }[];
  readonly implication: string | null;
  readonly interpretation: string | null;
}

async function extractWithModel(
  options: ExtractionOptions,
  event: PendingEvent,
): Promise<EventOutcome> {
  const { context } = options;
  const { value } = await options.llm.complete({
    tier: "deep",
    system: buildExtractionPrompt(context),
    material: formatExtractionMaterial({ title: event.title, content: event.content }),
    schema: extractionSchema,
    purpose: "extraction",
    tenantId: context.tenantId,
    temperature: 0,
    maxOutputTokens: 1_200,
  });

  return writeUp(options, event, value, hasStructuralFacts(context) ? value.implication : null);
}

async function writeUp(
  options: ExtractionOptions,
  event: PendingEvent,
  draft: Draft,
  proposedImplication: string | null,
): Promise<EventOutcome> {
  const { db, context, logger } = options;
  const { kept, dropped } = verifyFacts(event.content, draft.facts);

  if (kept.length === 0) {
    await dropEvent(db, context, event, {
      reason: "no_verified_quote",
      detail: `None of ${draft.facts.length} quoted passage(s) could be found in the source.`,
    });
    return outcome(event, "no_verified_quote", {
      factsDropped: dropped.length,
      droppedQuotes: dropped,
    });
  }

  const implication = screenImplication(proposedImplication, logger, event.id);

  await db.transaction(async (transaction) => {
    await transaction.insert(schema.facts).values(
      kept.map((fact) => ({
        id: uuidv7(),
        tenantId: context.tenantId,
        eventId: event.id,
        statement: fact.statement,
        quote: fact.quote,
        quoteStartOffset: fact.startOffset,
        quoteEndOffset: fact.endOffset,
      })),
    );
    await transaction
      .update(schema.events)
      .set({
        ...(draft.summary === null ? {} : { summary: draft.summary }),
        implication,
        interpretation: draft.interpretation,
      })
      .where(scoped(schema.events, context.tenantId, eq(schema.events.id, event.id)));
  });

  return outcome(event, "extracted", {
    factsKept: kept.length,
    factsDropped: dropped.length,
    droppedQuotes: dropped,
  });
}

/** Keep the facts whose quote is in the text, with offsets computed here. */
export function verifyFacts(
  content: string,
  facts: readonly { readonly statement: string; readonly quote: string }[],
): { readonly kept: VerifiedFact[]; readonly dropped: string[] } {
  const kept: VerifiedFact[] = [];
  const dropped: string[] = [];

  for (const fact of facts.slice(0, MAX_FACTS)) {
    const match = findQuote(content, fact.quote);
    if (match === null) {
      dropped.push(fact.quote);
      continue;
    }
    kept.push({
      statement: fact.statement,
      quote: match.text,
      startOffset: match.startOffset,
      endOffset: match.endOffset,
    });
  }

  return { kept, dropped };
}

/**
 * The facts of a page change are its own lines. Added lines first — they are
 * what the page says now; removed lines only when nothing was added.
 */
export function factsFromDiff(event: {
  readonly addedText: string | null;
  readonly removedText: string | null;
}): Draft {
  const pick = (text: string | null): string[] =>
    (text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= MIN_QUOTE_LENGTH)
      .slice(0, MAX_FACTS);

  const added = pick(event.addedText);
  const lines = added.length > 0 ? added : pick(event.removedText);
  const prefix = added.length > 0 ? "" : "Removed: ";

  return {
    summary: null,
    facts: lines.map((line) => ({ statement: `${prefix}${line}`, quote: line })),
    implication: null,
    interpretation: null,
  };
}

function screenImplication(
  implication: string | null,
  logger: Logger,
  eventId: string,
): string | null {
  if (implication === null || implication.trim() === "") return null;

  const directive = findDirective(implication);
  if (directive !== null) {
    logger.warn("pipeline.implication_discarded", { eventId, directive });
    return null;
  }

  return implication;
}

async function dropEvent(
  db: Queryable,
  context: ProfileContext,
  event: PendingEvent,
  why: { readonly reason: "no_verified_quote" | "model_rejected"; readonly detail: string },
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.insert(schema.rejections).values({
      id: uuidv7(),
      tenantId: context.tenantId,
      profileId: context.profileId,
      rawItemId: event.rawItemId,
      reason: why.reason,
      detail: why.detail,
      score: Math.min(1, Math.max(-1, event.relevanceScore)).toFixed(3),
    });
    await transaction
      .delete(schema.events)
      .where(scoped(schema.events, context.tenantId, eq(schema.events.id, event.id)));
  });
}

async function findPendingEvents(
  db: Queryable,
  context: ProfileContext,
  now: Date,
): Promise<PendingEvent[]> {
  const since = new Date(now.getTime() - PENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return db
    .select({
      id: schema.events.id,
      rawItemId: schema.events.rawItemId,
      isUrgent: schema.events.isUrgent,
      relevanceScore: schema.events.relevanceScore,
      createdAt: schema.events.createdAt,
      title: schema.rawItems.title,
      content: schema.rawItems.content,
      kind: schema.rawItems.kind,
      addedText: schema.rawItems.addedText,
      removedText: schema.rawItems.removedText,
    })
    .from(schema.events)
    .innerJoin(schema.rawItems, eq(schema.rawItems.id, schema.events.rawItemId))
    .where(
      scoped(
        schema.events,
        context.tenantId,
        eq(schema.events.profileId, context.profileId),
        gte(schema.events.createdAt, since),
        notExists(
          db
            .select({ id: schema.facts.id })
            .from(schema.facts)
            .where(eq(schema.facts.eventId, schema.events.id)),
        ),
      ),
    )
    .orderBy(asc(schema.events.createdAt))
    .limit(MAX_EVENTS_PER_RUN);
}

function outcome(
  event: PendingEvent,
  result: EventOutcome["outcome"],
  extra: Partial<Pick<EventOutcome, "factsKept" | "factsDropped" | "droppedQuotes" | "mergedInto">>,
): EventOutcome {
  return {
    eventId: event.id,
    rawItemId: event.rawItemId,
    outcome: result,
    factsKept: extra.factsKept ?? 0,
    factsDropped: extra.factsDropped ?? 0,
    droppedQuotes: extra.droppedQuotes ?? [],
    mergedInto: extra.mergedInto ?? null,
    isUrgent: event.isUrgent,
  };
}
