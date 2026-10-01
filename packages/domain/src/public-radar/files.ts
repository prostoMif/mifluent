/**
 * The shape of a radar file in `radar/`: one public profile and the companies
 * it follows. Pure — the worker's CLI reads the YAML, this decides whether it
 * is a radar file.
 */

import { z } from "zod";

const surfaceSchema = z
  .object({
    type: z.enum(["feed", "diff", "query"]),
    url: z.url({ protocol: /^https?$/ }),
    label: z.string().min(2).max(80),
    interval_minutes: z
      .number()
      .int()
      .min(60)
      .max(7 * 24 * 60),
  })
  .strict();

const companySchema = z
  .object({
    name: z.string().min(1).max(120),
    website: z
      .url({ protocol: /^https?$/ })
      .nullable()
      .default(null),
    category: z.string().min(2).max(40),
    /** Empty is allowed: the owner adds surfaces later, or discovery finds them. */
    surfaces: z.array(surfaceSchema).max(10).default([]),
  })
  .strict();

export const radarFileSchema = z
  .object({
    profile: z
      .object({
        name: z.string().min(2).max(120),
        language: z.enum(["en", "ru"]),
        /** What selection compares material against: what counts as a change worth a page. */
        description: z.string().min(20).max(2_000),
      })
      .strict(),
    companies: z.array(companySchema).min(1).max(100),
  })
  .strict();

export type RadarFile = z.infer<typeof radarFileSchema>;
export type RadarCompany = RadarFile["companies"][number];

export function parseRadarFile(
  value: unknown,
): { ok: true; file: RadarFile } | { ok: false; error: string } {
  const result = radarFileSchema.safeParse(value);
  if (result.success) return { ok: true, file: result.data };
  return {
    ok: false,
    error: result.error.issues
      .map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`)
      .join("; "),
  };
}

const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/** The address of a company's public page: "Яндекс Маркет" → "yandeks-market". */
export function slugify(name: string): string {
  return Array.from(name.toLowerCase(), (char) => CYRILLIC[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
