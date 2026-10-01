/**
 * Prompt for the monthly report introduction.
 *
 * The expensive model writes ONLY a 2–3 sentence executive summary from
 * pre-verified fact summaries. Every sentence must reference event IDs from
 * the input — validated in code. No directives, no advice, no invented facts.
 *
 * // TODO: security review — assembles prompts
 */

import { z } from "zod";

export const MONTHLY_INTRO_PROMPT_VERSION = "monthly-intro-2026-10-01";

export const monthlyIntroSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(1).max(500),
        eventIds: z.array(z.string().uuid()).min(1).max(3),
      }),
    )
    .min(1)
    .max(3),
});

export type MonthlyIntroAnswer = z.infer<typeof monthlyIntroSchema>;

export interface MonthlyEventSummaryForPrompt {
  readonly index: number; // 1-based for the prompt
  readonly id: string;
  readonly targetName: string | null;
  readonly kind: string | null;
  readonly summary: string;
  readonly facts: readonly { readonly statement: string; readonly quote: string }[];
}

/** Build the system prompt for the monthly intro. */
export function buildMonthlyIntroPrompt(language: "en" | "ru"): string {
  const lang = language === "ru" ? "Russian" : "English";

  return [
    `You write a brief executive summary for a business owner's monthly market report.`,
    `Language: ${lang}.`,
    "",
    "Input: a list of the month's most significant events, each with verified facts and quotes.",
    "Each event is prefixed with a number in brackets: [1], [2], etc.",
    "Output: 2–3 sentences. Each sentence MUST reference one or more event numbers",
    "using the format [1], [2], etc. (the numbers in brackets before each event).",
    "Do not invent facts. Do not give advice. Do not use directives.",
    "If you cannot write a grounded summary, return an empty sentences array.",
  ].join("\n");
}

/** Format the event summaries for the model. */
export function formatMonthlyIntroMaterial(
  events: readonly MonthlyEventSummaryForPrompt[],
): string {
  if (events.length === 0) {
    return "No significant events this month.";
  }

  return [
    "Top events this month:",
    "",
    ...events.map((e) => {
      const factsText = e.facts.map((f) => `- ${f.statement} («${f.quote}»)`).join("\n");
      const target = e.targetName ?? "general";
      const kind = e.kind ?? "other";
      return `[${e.index}] Event ${e.id} (${target}, ${kind}): ${e.summary}\n${factsText}`;
    }),
  ].join("\n\n");
}
