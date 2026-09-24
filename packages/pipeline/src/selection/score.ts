/**
 * The free step of selection, as pure functions.
 *
 * Each item is scored by its best chunk against its best-matching profile
 * vector. Max rather than mean: an article that is mostly about something else
 * but has one paragraph about a competitor's price change is exactly what the
 * product exists to catch, and averaging would bury it.
 *
 * Computed in code rather than with pgvector's `<=>`: the profile has a few
 * dozen vectors and a day's new material a few hundred chunks, so the whole
 * comparison is a millisecond of arithmetic — and as a pure function it can be
 * tested on synthetic vectors, which a query cannot.
 */

import { cosineSimilarity } from "@mifluent/embeddings";
import type { ProfileVector } from "../profile.js";

export interface ItemScore {
  readonly score: number;
  /** The target the best match points at, when the best match was a target. */
  readonly nearestTargetId: string | null;
}

export function scoreItem(
  chunkVectors: readonly (readonly number[])[],
  profileVectors: readonly ProfileVector[],
): ItemScore {
  let best: ItemScore = { score: -1, nearestTargetId: null };

  for (const chunk of chunkVectors) {
    for (const profile of profileVectors) {
      const score = cosineSimilarity(chunk, profile.vector);
      if (score > best.score) {
        best = { score, nearestTargetId: profile.refKind === "target" ? profile.refId : null };
      }
    }
  }

  return best;
}

/**
 * The cut-off for the free step.
 *
 * Deliberately wide — the profile's threshold minus 0.15 — because this step
 * only has to throw away what is obviously unrelated. Deciding between
 * "related" and "relevant" is the cheap model's job, and a strict cosine cut
 * would make that decision with a much blunter tool.
 */
export function cosineCutoff(relevanceThreshold: number): number {
  return relevanceThreshold - 0.15;
}

/** The stopword found in a title, if any. Whole words, any case. */
export function findStopword(title: string | null, stopwords: readonly string[]): string | null {
  if (title === null) return null;
  const normalised = ` ${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;

  for (const stopword of stopwords) {
    const term = stopword
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (term !== "" && normalised.includes(` ${term} `)) return stopword;
  }

  return null;
}
