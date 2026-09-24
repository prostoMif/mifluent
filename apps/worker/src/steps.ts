/**
 * The pipeline steps as the worker runs them: one function per step, taking a
 * tenant or a profile and doing the whole step.
 *
 * Both the queue handlers and the onboarding first run call these, so the
 * cascade a new profile goes through is the same one every later day runs.
 */

import { getConfig } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { type BuiltDigest, buildPeriodDigest, buildUrgentDigest } from "@mifluent/digest";
import { readCostCap } from "@mifluent/domain";
import {
  type EmbedItemsResult,
  type ExtractionResult,
  embedPendingItems,
  extractForProfile,
  loadProfileContext,
  type ProfileRef,
  type SelectionResult,
  selectForProfile,
} from "@mifluent/pipeline";
import {
  createCostGuard,
  createPipelineLlm,
  deliveryDefaults,
  getEmbedder,
  logger,
} from "./runtime.js";

export async function embedTenant(db: Queryable, tenantId: string): Promise<EmbedItemsResult> {
  const result = await embedPendingItems({ db, tenantId, provider: getEmbedder() });
  logger.info("items.embedded", { tenantId, ...result });
  return result;
}

export type StepSkip = "profile_missing" | "llm_not_configured";

export async function selectProfile(
  db: Queryable,
  ref: ProfileRef,
): Promise<SelectionResult | StepSkip> {
  const context = await loadProfileContext(db, ref.tenantId, ref.profileId);
  if (context === undefined) return "profile_missing";

  const llm = createPipelineLlm(db);
  if (llm === undefined) return "llm_not_configured";

  return selectForProfile({
    db,
    context,
    provider: getEmbedder(),
    llm,
    guard: createCostGuard(db),
    logger,
  });
}

export async function extractProfile(
  db: Queryable,
  ref: ProfileRef,
): Promise<ExtractionResult | StepSkip> {
  const context = await loadProfileContext(db, ref.tenantId, ref.profileId);
  if (context === undefined) return "profile_missing";

  const llm = createPipelineLlm(db);
  if (llm === undefined) return "llm_not_configured";

  return extractForProfile({
    db,
    context,
    llm,
    guard: createCostGuard(db),
    logger,
    embeddingModel: getEmbedder().model,
    clusterThreshold: getConfig().CLUSTER_THRESHOLD,
  });
}

/** Urgent events that were just written up each get a digest of their own. */
export async function buildUrgentDigests(
  db: Queryable,
  ref: ProfileRef,
  result: ExtractionResult,
): Promise<BuiltDigest[]> {
  const built: BuiltDigest[] = [];
  for (const outcome of result.outcomes) {
    if (!outcome.isUrgent || outcome.outcome !== "extracted") continue;
    const digest = await buildUrgentDigest(await buildContext(db, ref), outcome.eventId);
    if (digest !== null) built.push(digest);
  }
  return built;
}

export async function buildDigestNow(
  db: Queryable,
  ref: ProfileRef,
  now: Date,
): Promise<BuiltDigest> {
  return buildPeriodDigest(await buildContext(db, ref), now);
}

async function buildContext(db: Queryable, ref: ProfileRef) {
  const cap = await readCostCap(db, getConfig().DAILY_COST_CAP_USD);
  return {
    db,
    tenantId: ref.tenantId,
    profileId: ref.profileId,
    defaults: deliveryDefaults(),
    isCostCapReached: cap.isReached,
  };
}
