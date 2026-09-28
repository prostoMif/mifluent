/**
 * Priority of a candidate for the cheap model queue.
 *
 * The budget is shared, but items are seen in priority order and priority 0
 * has a small separate reserve. This keeps price changes and policy updates
 * from being crowded out by a flood of news.
 */

import type { Candidate } from "./select.js";

export type Priority = 0 | 1 | 2;

/** Maximum model calls per day reserved for priority-0 items (diff/job with target). */
export const DIFF_RESERVE_PER_DAY = 10;

/**
 * Returns the priority of a candidate.
 *
 * 0 — diff / job with a source target_id (the source is attached to a target).
 * 1 — release and items from a source with target_id (blog, changelog, target status page).
 * 2 — everything else (Google News queries, Reddit, manual feeds without a target).
 */
export function priorityOf(candidate: Candidate): Priority {
  const hasTarget = candidate.sourceTargetId !== null;
  const isDiffOrJob = candidate.kind === "diff" || candidate.kind === "job";

  if (isDiffOrJob && hasTarget) return 0;
  if (isDiffOrJob || candidate.kind === "release" || hasTarget) return 1;
  return 2;
}
