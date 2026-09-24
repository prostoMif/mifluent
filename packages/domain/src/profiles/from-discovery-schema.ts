/**
 * What the onboarding screen sends when a person accepts (and edits) what
 * discovery proposed. Pure, so the browser validates with the same rules.
 *
 * Everything here arrived from a model reading somebody's website, then went
 * through a person's hands in a browser — it is validated as untrusted input,
 * not as our own output.
 */

import { httpUrlSchema } from "@mifluent/core";
import { z } from "zod";
import { WATCH_TARGET_KINDS } from "./schemas.js";

export const DISCOVERY_SURFACE_TYPES = ["feed", "diff", "json", "query"] as const;

const MAX_SURFACES_PER_TARGET = 10;

const optionalLine = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

export const discoveredSurfaceSchema = z.object({
  type: z.enum(DISCOVERY_SURFACE_TYPES),
  url: httpUrlSchema,
  label: z.string().trim().min(1).max(80),
  pollIntervalMinutes: z
    .number()
    .int()
    .min(10)
    .max(7 * 24 * 60),
});

export const discoveredTargetSchema = z.object({
  kind: z.enum(WATCH_TARGET_KINDS),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  websiteUrl: httpUrlSchema.nullable(),
  reason: z.string().trim().max(400).nullable(),
  surfaces: z.array(discoveredSurfaceSchema).max(MAX_SURFACES_PER_TARGET),
});

export const profileFromDiscoverySchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  businessDescription: z.string().trim().max(2_000).nullable(),
  websiteUrl: httpUrlSchema.nullable(),
  facts: z.object({
    monetization: z.enum(["free", "trial", "subscription", "one_time", "unknown"]),
    platforms: z.array(z.string().trim().min(1).max(80)).max(20),
    countries: z.array(z.string().trim().min(1).max(80)).max(30),
    customerType: optionalLine(80),
    whatMatters: optionalLine(400),
    language: z.enum(["en", "ru"]),
  }),
  targets: z.array(discoveredTargetSchema).max(50),
});

export type DiscoveredSurfaceInput = z.infer<typeof discoveredSurfaceSchema>;
export type DiscoveredTargetInput = z.infer<typeof discoveredTargetSchema>;
export type ProfileFromDiscoveryInput = z.infer<typeof profileFromDiscoverySchema>;
