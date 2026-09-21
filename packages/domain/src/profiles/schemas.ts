/**
 * What a watch profile may contain.
 *
 * The upper bounds below are not safety limits, they are honesty limits. A
 * profile with two hundred topics does not produce a better digest; it produces
 * a filter that matches everything, an expensive extraction bill, and a person
 * who concludes the product does not work. Each number is a guess that can be
 * raised once somebody hits it for a real reason.
 */

import { httpUrlSchema } from "@mifluent/core";
import { z } from "zod";

export const WATCH_TARGET_KINDS = ["competitor", "platform", "condition"] as const;

export type WatchTargetKind = (typeof WATCH_TARGET_KINDS)[number];

/** Roughly a paragraph. Long enough to describe a business, short enough to embed well. */
const MAXIMUM_DESCRIPTION_LENGTH = 2_000;

/** A topic is a phrase, not an essay. */
const MAXIMUM_TOPIC_LABEL_LENGTH = 80;
const MAXIMUM_TOPIC_DESCRIPTION_LENGTH = 400;

/** Past this many topics the profile stops describing anything in particular. */
const MAXIMUM_TOPICS = 30;
const MAXIMUM_TARGETS = 50;
const MAXIMUM_STOPWORDS = 50;
const MAXIMUM_ALIASES = 10;

/** Blank optional text arrives from a form as "" and means "not set". */
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

const optionalUrl = httpUrlSchema
  .or(z.literal(""))
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

export const topicInputSchema = z.object({
  label: z.string().trim().min(1, "Enter a topic.").max(MAXIMUM_TOPIC_LABEL_LENGTH),
  /** Longer phrasing for embedding. A bare label matches poorly. */
  description: optionalText(MAXIMUM_TOPIC_DESCRIPTION_LENGTH),
});

export const watchTargetInputSchema = z.object({
  kind: z.enum(WATCH_TARGET_KINDS),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  websiteUrl: optionalUrl,
  aliases: z.array(z.string().trim().min(1).max(80)).max(MAXIMUM_ALIASES).default([]),
  /** Why this matters to the business. Written by the model, editable by hand. */
  reason: optionalText(400),
});

export const watchProfileInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  businessDescription: optionalText(MAXIMUM_DESCRIPTION_LENGTH),
  websiteUrl: optionalUrl,
  /**
   * 0 lets everything through, 1 almost nothing. Stored rather than fixed
   * because the right value differs by niche — see the schema notes.
   */
  relevanceThreshold: z.number().min(0).max(1),
  topics: z.array(topicInputSchema).max(MAXIMUM_TOPICS),
  targets: z.array(watchTargetInputSchema).max(MAXIMUM_TARGETS),
  stopwords: z.array(z.string().trim().min(1).max(80)).max(MAXIMUM_STOPWORDS),
  /** Shown in the profile history next to the version this save creates. */
  changeReason: optionalText(200),
});

export type TopicInput = z.infer<typeof topicInputSchema>;
export type WatchTargetInput = z.infer<typeof watchTargetInputSchema>;
export type WatchProfileInput = z.infer<typeof watchProfileInputSchema>;
