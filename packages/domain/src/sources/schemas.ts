/**
 * What a person may type when adding a source.
 *
 * Only RSS is listed. The others exist in the database enum because the schema
 * was written for all of them at once, but a connector that does not exist yet
 * must not be offerable — a source that can be added and never polled is worse
 * than one that cannot be added.
 */

import { httpUrlSchema } from "@mifluent/core";
import { z } from "zod";

export const AVAILABLE_SOURCE_KINDS = ["rss"] as const;

export type AvailableSourceKind = (typeof AVAILABLE_SOURCE_KINDS)[number];

/** An hour. Feeds are checked often enough to be a morning brief, no oftener. */
export const DEFAULT_POLL_INTERVAL_MINUTES = 60;

/** Ten minutes is the floor. Below it a polite client stops being one. */
const MINIMUM_POLL_INTERVAL_MINUTES = 10;

/** A week. Beyond that the source is effectively paused, so pause it instead. */
const MAXIMUM_POLL_INTERVAL_MINUTES = 7 * 24 * 60;

export const sourceInputSchema = z.object({
  kind: z.enum(AVAILABLE_SOURCE_KINDS),
  /** What the person calls it. Shown wherever the source is mentioned. */
  label: z.string().trim().min(1, "Give it a name.").max(120),
  locator: httpUrlSchema,
  pollIntervalMinutes: z.coerce
    .number()
    .int()
    .min(MINIMUM_POLL_INTERVAL_MINUTES)
    .max(MAXIMUM_POLL_INTERVAL_MINUTES)
    .default(DEFAULT_POLL_INTERVAL_MINUTES),
});

export type SourceInput = z.infer<typeof sourceInputSchema>;

export type SourceStatus = "active" | "paused" | "broken";

/** The shape a source is read as. Types only, so a browser may name them. */
export interface SourceSummary {
  readonly id: string;
  readonly kind: string;
  readonly status: SourceStatus;
  readonly label: string;
  readonly locator: string | null;
  readonly pollIntervalMinutes: number;
  readonly lastPolledAt: Date | null;
  readonly lastSucceededAt: Date | null;
  readonly lastErrorMessage: string | null;
  readonly consecutiveFailures: number;
  readonly itemCount: number;
}
