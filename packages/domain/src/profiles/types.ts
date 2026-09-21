/**
 * The shapes a watch profile is read as.
 *
 * Types only, in their own file, so that a browser component can name them
 * without importing the queries that produce them. TypeScript erases these
 * before anything is bundled — the file exists so that the import line does not
 * have to reach into `read.ts`, which does touch the database.
 */

import type { WatchTargetKind } from "./schemas.js";

export interface WatchProfileSummary {
  readonly id: string;
  readonly name: string;
  readonly businessDescription: string | null;
  readonly websiteUrl: string | null;
  readonly relevanceThreshold: number;
  /** Null until the first save that affects selection. */
  readonly currentVersion: number | null;
  readonly updatedAt: Date;
}

export interface WatchProfileTopic {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
}

export interface WatchProfileTarget {
  readonly id: string;
  readonly kind: WatchTargetKind;
  readonly name: string;
  readonly websiteUrl: string | null;
  readonly aliases: readonly string[];
  readonly reason: string | null;
}

export interface WatchProfileDetail extends WatchProfileSummary {
  readonly topics: readonly WatchProfileTopic[];
  readonly targets: readonly WatchProfileTarget[];
  readonly stopwords: readonly string[];
}
