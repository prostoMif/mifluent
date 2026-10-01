/**
 * The shape discovery returns, and the shape it asks the model for.
 */

import { z } from "zod";

export const SURFACE_TYPES = ["feed", "diff", "json", "query"] as const;

export const surfaceSchema = z.object({
  type: z.enum(SURFACE_TYPES),
  url: z.string(),
  label: z.string(),
  pollIntervalMinutes: z.number().int().positive(),
  /** Fetched during discovery and answered with something usable. */
  verified: z.boolean(),
});

export type Surface = z.infer<typeof surfaceSchema>;

export const TARGET_KINDS = ["competitor", "platform", "condition", "self"] as const;

export const businessSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(1_000),
  niche: z.string().max(200),
  monetization: z.enum(["free", "trial", "subscription", "one_time", "unknown"]),
  platforms: z.array(z.string().max(100)).max(20),
  countries: z.array(z.string().max(100)).max(30),
  country: z.string().max(2).optional(),
  extraCountries: z.array(z.string().max(2)).max(5).optional(),
  homeCountry: z.string().max(2).optional(),
  region: z.string().max(10).optional(),
  customerType: z.string().max(100),
  language: z.enum(["en", "ru"]),
  websiteUrl: z.string().nullable().optional(),
});

export type Business = z.infer<typeof businessSchema>;

export const targetSchema = z.object({
  kind: z.enum(TARGET_KINDS),
  name: z.string(),
  websiteUrl: z.string().nullable(),
  reason: z.string(),
  surfaces: z.array(surfaceSchema),
  /** Precise news query for Google News, written by the model (≤ 120 chars). */
  newsQuery: z.string().max(120).optional(),
});

export type DiscoveredTarget = z.infer<typeof targetSchema>;

export const conditionSchema = z.object({
  name: z.string(),
  reason: z.string(),
  surfaces: z.array(surfaceSchema),
  /** Precise news query for Google News, written by the model (≤ 120 chars). */
  newsQuery: z.string().max(120).optional(),
});

export type DiscoveredCondition = z.infer<typeof conditionSchema>;

export const discoveryResultSchema = z.object({
  business: businessSchema,
  targets: z.array(targetSchema),
  conditions: z.array(conditionSchema),
  /** The site said too little to go on; ask the person to describe the business. */
  needsDescription: z.boolean(),
});

export type DiscoveryResult = z.infer<typeof discoveryResultSchema>;

/** What the model is asked for. Surfaces are found by code, not by the model. */
export const modelAnswerSchema = z.object({
  business: businessSchema.extend({
    websiteUrl: z.string().max(300).nullable().optional(),
  }),
  targets: z
    .array(
      z.object({
        kind: z.enum(TARGET_KINDS),
        name: z.string().min(1).max(120),
        websiteUrl: z.string().max(300).nullable(),
        reason: z.string().max(400),
        /** Precise news query for Google News (≤ 120 chars). If the name is a common word, add a disambiguator. */
        newsQuery: z.string().max(120).optional(),
      }),
    )
    .max(12),
  conditions: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        reason: z.string().max(400),
        /** Precise news query for Google News (≤ 120 chars). If the name is a common word, add a disambiguator. */
        newsQuery: z.string().max(120).optional(),
      }),
    )
    .max(4),
});

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
