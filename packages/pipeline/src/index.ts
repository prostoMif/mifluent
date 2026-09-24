export { type EmbedItemsOptions, type EmbedItemsResult, embedPendingItems } from "./embed.js";
export { clusterEvent, findClusterAnchor } from "./extraction/cluster.js";
export { findDirective } from "./extraction/directives.js";
export {
  type EventOutcome,
  type ExtractionOptions,
  type ExtractionResult,
  extractForProfile,
  factsFromDiff,
  type VerifiedFact,
  verifyFacts,
} from "./extraction/extract.js";
export { findQuote, type QuoteMatch } from "./extraction/quote.js";
export { type CostGuard, neverCapped } from "./guard.js";
export {
  type PruneCounts,
  pruneExpiredMaterial,
  pruneRejections,
  REJECTION_RETENTION_DAYS,
} from "./maintenance.js";
export {
  listRunnableProfiles,
  listTenantProfiles,
  loadProfileContext,
  loadProfileVectors,
  type ProfileContext,
  type ProfileLanguage,
  type ProfileRef,
  type ProfileTarget,
  type ProfileVector,
} from "./profile.js";
export { cosineCutoff, findStopword, scoreItem } from "./selection/score.js";
export {
  MAX_MODEL_CALLS_PER_DAY,
  pickTarget,
  type SelectionDecision,
  type SelectionOptions,
  type SelectionResult,
  selectForProfile,
} from "./selection/select.js";
