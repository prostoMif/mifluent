/**
 * The text of a public radar post: what the company did, the verbatim quote,
 * the original source, the company's page on our site, and one line about
 * Mifluent. Plain text — the channel shows links as links.
 *
 * Telegram allows 4 096 characters and X 280; the quote is trimmed to fit,
 * never the source link.
 */

export interface RadarPostInput {
  readonly language: "en" | "ru";
  readonly company: string;
  readonly summary: string;
  readonly quote: string | null;
  readonly sourceUrl: string | null;
  /** Our page for the company: https://mifluent.com/changes/notion */
  readonly pageUrl: string;
  /** Where the last line points: the bot for Russian, the site for English. */
  readonly ctaUrl: string | null;
}

export const TELEGRAM_POST_LIMIT = 4_096;
export const X_POST_LIMIT = 280;
/** X counts every link as 23 characters, whatever its length. */
const X_LINK_LENGTH = 23;

const TEXT = {
  en: { source: "Source", history: "Full history", cta: "Want this for your own competitors →" },
  ru: { source: "Источник", history: "Вся история", cta: "Хочешь такое про своих конкурентов →" },
} as const;

export function composeTelegramPost(input: RadarPostInput): string {
  const text = TEXT[input.language];
  const head = `${input.company}: ${input.summary}`;
  const tail = [
    input.sourceUrl === null ? null : `${text.source}: ${input.sourceUrl}`,
    `${text.history}: ${input.pageUrl}`,
    input.ctaUrl === null ? null : `${text.cta} ${input.ctaUrl}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const room = TELEGRAM_POST_LIMIT - head.length - tail.length - 8;
  const quote = input.quote === null ? null : `«${clip(input.quote, Math.max(0, room))}»`;
  return [head, quote, tail].filter((part): part is string => part !== null).join("\n\n");
}

/** Headline, a short quote if it fits, and the source link. */
export function composeXPost(input: RadarPostInput): string {
  const head = clip(`${input.company}: ${input.summary}`, 180);
  const link = input.sourceUrl ?? input.pageUrl;
  const room = X_POST_LIMIT - head.length - X_LINK_LENGTH - 6;
  const quote = input.quote !== null && room >= 40 ? ` “${clip(input.quote, room)}”` : "";
  return `${head}${quote}\n${link}`;
}

/** Length as X counts it: links are 23 characters each. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(X_LINK_LENGTH)).length;
}

export interface WeeklyItem {
  readonly company: string;
  readonly summary: string;
  readonly pageUrl: string;
}

export function composeWeeklyPost(
  language: "en" | "ru",
  items: readonly WeeklyItem[],
  ctaUrl: string | null,
): string {
  const title = language === "ru" ? "Что поменялось за неделю" : "What changed this week";
  const lines: string[] = [];
  let length = title.length + 200;
  for (const item of items) {
    const line = `• ${item.company}: ${item.summary} — ${item.pageUrl}`;
    if (length + line.length + 1 > TELEGRAM_POST_LIMIT) break;
    lines.push(line);
    length += line.length + 1;
  }
  const cta = ctaUrl === null ? "" : `\n\n${TEXT[language].cta} ${ctaUrl}`;
  return `${title}\n\n${lines.join("\n")}${cta}`;
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
