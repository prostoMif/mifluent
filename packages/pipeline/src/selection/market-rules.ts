/**
 * Code-side checks on the cheap model's relevance answer for market material:
 * laws, taxes, platform rules and market news.
 *
 * The model is told to judge country and urgency; these functions are the
 * guard for when it judges wrong. A German tax change is not relevant to a
 * business in Russia whatever the model says, and an "effective in two years"
 * rule is not urgent whatever the model says.
 */

import type { RelevanceAnswer } from "../prompts/selection.js";

/** A rule taking effect this soon is something to act on now, not on Monday. */
export const URGENT_RULE_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProfileCountries {
  readonly country?: string | undefined;
  readonly extraCountries?: readonly string[] | undefined;
  readonly homeCountry?: string | undefined;
}

/**
 * True when the model called a law or market story relevant although it is
 * about a country the business neither sells in nor is based in. A profile
 * with no countries yet is never contradicted: there is nothing to check
 * against.
 */
export function isWrongCountry(answer: RelevanceAnswer, profile: ProfileCountries): boolean {
  if (answer.scope !== "market_rule" && answer.scope !== "market_news") return false;
  if (answer.geo === null) return false;

  const countries = [
    profile.country,
    profile.homeCountry,
    ...(profile.extraCountries ?? []),
  ].filter((code): code is string => code !== undefined);
  if (countries.length === 0) return false;
  return !countries.includes(answer.geo);
}

/** A rule is urgent only when it states a date within the next thirty days. */
export function isUrgentRule(answer: RelevanceAnswer, now: Date): boolean {
  if (answer.scope !== "market_rule" || answer.effectiveDate === null) return false;

  const effective = Date.parse(`${answer.effectiveDate}T00:00:00Z`);
  if (Number.isNaN(effective)) return false;

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return effective >= today && effective - today <= URGENT_RULE_WINDOW_DAYS * DAY_MS;
}

/**
 * The event kind for an article. Market material keeps its scope, so the
 * digest can put it in the "your market & rules" section and order it.
 */
export function articleEventKind(itemKind: string, scope: RelevanceAnswer["scope"]): string {
  if (itemKind === "release") return "feature";
  if (scope === "market_rule" || scope === "market_news" || scope === "platform") return scope;
  return "news";
}
