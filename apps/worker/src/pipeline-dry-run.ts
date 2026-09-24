/**
 * The whole cascade for one profile, printed step by step, written nowhere.
 *
 * Usage:
 *   npm run pipeline:dry -- <profileId> [--since 7d] [--no-llm] [--explain <rawItemId>]
 *
 * Everything runs inside one transaction that is rolled back at the end: the
 * polls, the chunks, the verdicts, the digest. Material judged before is
 * un-judged inside that transaction first, so the run shows what the pipeline
 * would decide today rather than an empty "nothing new". Model calls are real
 * and cost real money; `--no-llm` stops before them.
 *
 * This is for the owner to check behaviour without reading code (TASK-013).
 */

import { getConfig, isUuid, toAppError } from "@mifluent/core";
import { type Queryable, schema, scoped } from "@mifluent/db";
import { loadDigestView } from "@mifluent/digest";
import { listProfilePollableSources } from "@mifluent/domain";
import type { UsageRecord } from "@mifluent/llm";
import {
  type EmbedItemsResult,
  type ExtractionResult,
  embedPendingItems,
  extractForProfile,
  loadProfileContext,
  type ProfileContext,
  type SelectionResult,
  selectForProfile,
} from "@mifluent/pipeline";
import { and, eq, gte, inArray } from "drizzle-orm";
import { pollSource } from "./poll-source.js";
import { createCostGuard, createPipelineLlm, getDatabase, getEmbedder, logger } from "./runtime.js";
import { buildDigestNow } from "./steps.js";

interface DryRunOptions {
  readonly profileId: string;
  readonly sinceDays: number;
  readonly isModelSkipped: boolean;
  readonly explainItemId: string | undefined;
}

interface Spend {
  selection: number;
  extraction: number;
}

/** Thrown to end the transaction; caught below and not an error. */
class DryRunFinished extends Error {}

const DEFAULT_SINCE_DAYS = 7;

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const options = readArguments(process.argv.slice(2));
  if (options === null) {
    process.stderr.write(
      "Usage: npm run pipeline:dry -- <profileId> [--since 7d] [--no-llm] [--explain <rawItemId>]\n",
    );
    process.exit(1);
  }

  const db = getDatabase();
  // Operator command: the id is typed by whoever runs the server, and the
  // tenant is taken from the profile row itself.
  const [profile] = await db
    .select({ tenantId: schema.watchProfiles.tenantId })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, options.profileId))
    .limit(1);

  if (profile === undefined) {
    process.stderr.write("No such profile.\n");
    process.exit(1);
  }

  try {
    await db.transaction(async (transaction) => {
      await run(transaction, { ...options, tenantId: profile.tenantId });
      throw new DryRunFinished();
    });
  } catch (thrown) {
    if (!(thrown instanceof DryRunFinished)) throw thrown;
  }

  say("\nNothing was written: the run was rolled back.");
  process.exit(0);
}

async function run(db: Queryable, options: DryRunOptions & { tenantId: string }): Promise<void> {
  const startedAt = performance.now();
  const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000);
  const spend: Spend = { selection: 0, extraction: 0 };
  const ref = { tenantId: options.tenantId, profileId: options.profileId };

  const context = await loadProfileContext(db, ref.tenantId, ref.profileId);
  if (context === undefined) {
    say("This profile has no saved version yet — save it once, then run again.");
    return;
  }

  await forgetVerdicts(db, context, since);

  const fetch = await timed(() => fetchAll(db, context));
  say(
    `Fetch:      ${fetch.value.sources} sources, ${fetch.value.stored} new items, ${fetch.value.failed} failed, ${fetch.seconds}s`,
  );
  say(`Dedup:      -${fetch.value.duplicates} already stored`);

  const embed = await timed(() => embedAll(db, ref.tenantId));
  say(`Embed:      ${embed.value.chunks} chunks (${embed.value.reused} reused), ${embed.seconds}s`);

  const llm = options.isModelSkipped
    ? undefined
    : createPipelineLlm(db, (record: UsageRecord) => {
        if (record.purpose === "selection") spend.selection += record.costUsd;
        if (record.purpose === "extraction") spend.extraction += record.costUsd;
      });

  const selection = await timed(() =>
    selectForProfile({
      db,
      context,
      provider: getEmbedder(),
      llm,
      guard: createCostGuard(db),
      logger,
      since,
    }),
  );
  printSelection(selection.value, selection.seconds, spend, llm === undefined);

  if (llm === undefined) {
    printTopByCosine(selection.value, context);
    explain(options.explainItemId, selection.value, undefined);
    return;
  }

  const extraction = await timed(() =>
    extractForProfile({
      db,
      context,
      llm,
      guard: createCostGuard(db),
      logger,
      embeddingModel: getEmbedder().model,
      clusterThreshold: getConfig().CLUSTER_THRESHOLD,
    }),
  );
  printExtraction(extraction.value, extraction.seconds, spend);

  const digest = await buildDigestNow(db, ref, new Date());
  const view = await loadDigestView(db, ref.tenantId, digest.digestId);
  const urgent = view?.cards.filter((card) => card.isUrgent).length ?? 0;
  say(
    `Digest:     ${view?.cards.length ?? 0} cards (${urgent} urgent), ${view?.nearMisses.length ?? 0} near misses`,
  );

  const total = spend.selection + spend.extraction;
  say(`Total:      ${((performance.now() - startedAt) / 1000).toFixed(1)}s, $${total.toFixed(4)}`);

  explain(options.explainItemId, selection.value, extraction.value);
}

/** Inside the transaction only: let recent material be judged again. */
async function forgetVerdicts(db: Queryable, context: ProfileContext, since: Date): Promise<void> {
  const recent = db
    .select({ id: schema.rawItems.id })
    .from(schema.rawItems)
    .where(scoped(schema.rawItems, context.tenantId, gte(schema.rawItems.fetchedAt, since)));

  await db
    .delete(schema.rejections)
    .where(
      scoped(
        schema.rejections,
        context.tenantId,
        and(
          eq(schema.rejections.profileId, context.profileId),
          inArray(schema.rejections.rawItemId, recent),
        ),
      ),
    );
  await db
    .delete(schema.events)
    .where(
      scoped(
        schema.events,
        context.tenantId,
        and(
          eq(schema.events.profileId, context.profileId),
          inArray(schema.events.rawItemId, recent),
        ),
      ),
    );
}

async function fetchAll(db: Queryable, context: ProfileContext) {
  const sources = await listProfilePollableSources(db, context.tenantId, context.profileId);
  const totals = { sources: sources.length, stored: 0, duplicates: 0, failed: 0 };
  const now = new Date();

  for (const source of sources) {
    // Every source, due or not: the point is to see the whole cascade now.
    const outcome = await pollSource({ db, source, now });
    totals.stored += outcome.stored;
    totals.duplicates += outcome.duplicates;
    if (outcome.result === "failed") totals.failed += 1;
  }
  return totals;
}

async function embedAll(db: Queryable, tenantId: string): Promise<EmbedItemsResult> {
  const totals = { items: 0, chunks: 0, reused: 0, hasMore: false };
  for (;;) {
    const batch = await embedPendingItems({ db, tenantId, provider: getEmbedder() });
    totals.items += batch.items;
    totals.chunks += batch.chunks;
    totals.reused += batch.reused;
    if (!batch.hasMore) return totals;
  }
}

function printSelection(
  result: SelectionResult,
  seconds: string,
  spend: Spend,
  isModelSkipped: boolean,
): void {
  const stopwords = result.decisions.filter((decision) => decision.outcome === "stopword").length;
  const suffix = isModelSkipped
    ? "model step skipped (--no-llm)"
    : `model kept ${result.eventsCreated} of ${result.modelCalls}, $${spend.selection.toFixed(4)}`;
  say(
    `Select:     ${result.considered} considered, ${stopwords} stopword, cosine kept ${result.keptByCosine} → ${suffix}, ${seconds}s`,
  );
  if (result.status !== "completed") say(`            stopped early: ${result.status}`);
}

function printExtraction(result: ExtractionResult, seconds: string, spend: Spend): void {
  const outcomes = result.outcomes;
  const extracted = outcomes.filter((outcome) => outcome.outcome === "extracted");
  const kept = extracted.reduce((total, outcome) => total + outcome.factsKept, 0);
  const dropped = outcomes.reduce((total, outcome) => total + outcome.factsDropped, 0);
  const merged = outcomes.filter((outcome) => outcome.outcome === "merged").length;
  const noQuote = outcomes.filter((outcome) => outcome.outcome === "no_verified_quote").length;

  say(
    `Extract:    ${outcomes.length - merged} events → ${kept} facts (${dropped} dropped: no quote; ${noQuote} events dropped), ${seconds}s, $${spend.extraction.toFixed(4)}`,
  );
  say(`Cluster:    ${outcomes.length} → ${outcomes.length - merged} events`);
  if (result.status !== "completed") say(`            stopped early: ${result.status}`);
}

function printTopByCosine(result: SelectionResult, context: ProfileContext): void {
  const names = new Map(context.targets.map((target) => [target.id, target.name]));
  const top = [...result.decisions].sort((left, right) => right.score - left.score).slice(0, 10);

  say("\nTop 10 by cosine:");
  for (const decision of top) {
    const target =
      decision.nearestTargetId === null ? "—" : (names.get(decision.nearestTargetId) ?? "—");
    say(
      `  ${decision.score.toFixed(3)}  ${target.padEnd(20).slice(0, 20)}  ${decision.title ?? "(untitled)"}`,
    );
  }
}

function explain(
  itemId: string | undefined,
  selection: SelectionResult,
  extraction: ExtractionResult | undefined,
): void {
  if (itemId === undefined) return;

  say(`\nItem ${itemId}:`);
  const decision = selection.decisions.find((candidate) => candidate.rawItemId === itemId);
  if (decision === undefined) {
    say("  Not considered — outside the window, not embedded, or not from this profile's sources.");
    return;
  }

  say(`  Title:    ${decision.title ?? "(untitled)"}`);
  say(`  Cosine:   ${decision.score.toFixed(3)}`);
  say(`  Verdict:  ${decision.outcome}${decision.detail === null ? "" : ` — ${decision.detail}`}`);

  const outcome = extraction?.outcomes.find((candidate) => candidate.rawItemId === itemId);
  if (outcome === undefined) return;

  say(
    `  Extract:  ${outcome.outcome}, ${outcome.factsKept} fact(s) kept, ${outcome.factsDropped} dropped`,
  );
  if (outcome.mergedInto !== null) say(`  Merged into event ${outcome.mergedInto}`);
  for (const quote of outcome.droppedQuotes) say(`  ✗ not found in source: "${quote}"`);
}

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; seconds: string }> {
  const startedAt = performance.now();
  const value = await work();
  return { value, seconds: ((performance.now() - startedAt) / 1000).toFixed(1) };
}

function readArguments(args: readonly string[]): DryRunOptions | null {
  const [profileId] = args;
  if (profileId === undefined || !isUuid(profileId)) return null;

  const sinceArgument = valueAfter(args, "--since") ?? `${DEFAULT_SINCE_DAYS}d`;
  const sinceDays = Number.parseInt(sinceArgument, 10);
  if (!Number.isFinite(sinceDays) || sinceDays <= 0) return null;

  const explainItemId = valueAfter(args, "--explain");
  if (explainItemId !== undefined && !isUuid(explainItemId)) return null;

  return {
    profileId,
    sinceDays,
    isModelSkipped: args.includes("--no-llm"),
    explainItemId,
  };
}

/** `--flag value` or `--flag=value`. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline !== undefined) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

main().catch((error: unknown) => {
  const appError = toAppError(error);
  process.stderr.write(`Dry run failed: ${appError.message}\n`);
  logger.error("pipeline.dry_run_failed", { cause: error });
  process.exit(1);
});
