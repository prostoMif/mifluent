/**
 * The shape of a source pack file in `packs/`, and of the niche dictionary.
 *
 * Pure: no file system, no database. The worker's CLI reads and parses the
 * YAML and hands the parsed value here; these schemas decide whether it is a
 * pack. Errors carry the field path, because the person reading them is a
 * contributor editing a YAML file, not a developer reading a stack trace.
 */

import { z } from "zod";

const countryCode = z
  .string()
  .regex(/^([A-Z]{2}|\*)$/, "a two-letter ISO 3166-1 code in capitals, or *");

const sourceSchema = z
  .object({
    label: z.string().min(2).max(120),
    type: z.enum(["feed", "diff", "query"]),
    url: z.url({ protocol: /^https?$/ }),
    interval_minutes: z
      .number()
      .int()
      .min(60)
      .max(7 * 24 * 60),
    verified_at: z.string().nullable().optional(),
    broken: z.string().optional(),
  })
  .strict();

export const packFileSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^(ru|en)(\.[a-z0-9_-]+){2,4}$/,
        "market, then 2–4 dot-separated parts: ru.platforms.wildberries",
      ),
    title: z.object({ ru: z.string().min(2), en: z.string().min(2) }).strict(),
    market: z.enum(["ru", "en"]),
    countries: z.array(countryCode).min(1),
    regions: z
      .array(z.string().regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/, "ISO 3166-2, e.g. RU-MOW"))
      .default([]),
    applies_to: z.enum(["home", "sales", "any"]).default("any"),
    kind: z.enum(["platform", "regulator", "media", "niche_media", "events"]),
    niches: z.array(z.string().min(2)).default([]),
    applies_when: z
      .object({
        platforms_any: z.array(z.string().min(2)).default([]),
        niches_any: z.array(z.string().min(2)).default([]),
      })
      .strict()
      .default({ platforms_any: [], niches_any: [] }),
    sources: z.array(sourceSchema).min(1),
    max_cards_per_digest: z.number().int().min(1).max(6).default(3),
  })
  .strict()
  .refine((pack) => pack.key.startsWith(`${pack.market}.`), {
    message: "key must start with the pack's market",
    path: ["key"],
  });

export type PackFile = z.infer<typeof packFileSchema>;
export type PackSourceEntry = z.infer<typeof sourceSchema>;

export const nicheDictionarySchema = z.record(
  z.string().regex(/^[a-z_]+$/),
  z
    .object({
      aliases: z.object({ ru: z.array(z.string()), en: z.array(z.string()) }).strict(),
    })
    .strict(),
);

export type NicheDictionary = z.infer<typeof nicheDictionarySchema>;

/**
 * Parse one pack file's content. The error message names the file and every
 * field that failed, in the order a person would fix them.
 */
export function parsePackFile(fileName: string, value: unknown): PackFile {
  const result = packFileSchema.safeParse(value);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "(file)" : issue.path.join(".");
    return `  ${path}: ${issue.message}`;
  });
  throw new Error(`${fileName} is not a valid source pack:\n${lines.join("\n")}`);
}
