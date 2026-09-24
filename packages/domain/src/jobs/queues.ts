/**
 * Queue names and job payloads shared by the processes that send jobs and the
 * one that runs them.
 *
 * Pure: no queue client here. The web application sends two kinds of job —
 * reading a site during onboarding, and a new profile's first run — and must
 * name them exactly as the worker does. One definition, imported by both, is
 * what keeps a typo from becoming a queue nobody reads.
 */

import { z } from "zod";

/** Queue names follow `<domain>:<action>`. */
export const QUEUES = {
  sourcesTick: "sources:tick",
  sourcesPoll: "sources:poll",
  itemsEmbed: "items:embed",
  pipelineSelect: "pipeline:select",
  pipelineExtract: "pipeline:extract",
  digestTick: "digest:tick",
  digestBuild: "digest:build",
  digestDeliver: "digest:deliver",
  maintenanceDaily: "maintenance:daily",
  discoveryRun: "discovery:run",
  profileFirstRun: "profile:first_run",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Higher runs first. Onboarding jobs are something a person is watching a
 * progress screen for; everything else is background.
 */
export const INTERACTIVE_PRIORITY = 10;

export const discoveryJobSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string(),
  input: z.string().min(2).max(2_000),
  language: z.enum(["en", "ru"]),
});

export type DiscoveryJob = z.infer<typeof discoveryJobSchema>;

export const firstRunJobSchema = z.object({
  tenantId: z.string().uuid(),
  profileId: z.string().uuid(),
});

export type FirstRunJob = z.infer<typeof firstRunJobSchema>;
