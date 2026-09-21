/**
 * Turning the markup in a feed item into plain text.
 *
 * The schema stores text and never markup, and that decision does most of the
 * security work here. Markup is dangerous because of what a browser does with
 * it; text handed to a browser as text is inert. So the job is not to sanitise
 * HTML — deciding which tags and attributes are safe is genuinely hard — but to
 * throw all of it away, which is easy and cannot be got subtly wrong.
 *
 * That is also why this is written here rather than taken from a library. The
 * usual argument against hand-rolling a parser is that a mistake becomes a
 * bypass. It does not apply when the output is text: the worst a mistake can do
 * is leave a stray angle bracket in somebody's summary.
 *
 * What it does do carefully:
 *
 * - **Removes script and style bodies rather than their tags.** Stripping tags
 *   alone would leave the code itself as "text", so a summary would read as a
 *   page of JavaScript.
 * - **Keeps paragraph boundaries.** Block-level tags become line breaks, so a
 *   three-paragraph post does not arrive as one run-on sentence — which matters
 *   because the next stage splits this into chunks to embed.
 * - **Collapses whitespace,** because markup is full of indentation that means
 *   nothing once the tags are gone.
 */

import { decodeXmlEntities } from "./xml-entities.js";

/** Elements whose content is code or styling, not prose. */
const HIDDEN_ELEMENTS = /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

const COMMENTS = /<!--[\s\S]*?-->/g;

/** Elements that end a line of prose when they close. */
const BLOCK_ELEMENTS =
  /<\/?(p|div|br|li|ul|ol|tr|td|th|h[1-6]|blockquote|pre|section|article|header|footer|figure|figcaption)\b[^>]*>/gi;

const ANY_TAG = /<[^>]*>/g;

/** Three or more line breaks read as a gap, not as structure. */
const EXCESS_BREAKS = /\n{3,}/g;

const HORIZONTAL_SPACE = /[^\S\n]+/g;

const SPACE_AROUND_BREAKS = /[^\S\n]*\n[^\S\n]*/g;

/**
 * Common HTML named references that XML does not define.
 *
 * A short list rather than the full set of two thousand: these are the ones
 * that actually appear in feeds, and anything else is left visible rather than
 * guessed at. See `xml-entities.ts` for why guessing is avoided.
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&hellip;": "…",
  "&laquo;": "«",
  "&raquo;": "»",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&middot;": "·",
  "&bull;": "•",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&deg;": "°",
  "&euro;": "€",
  "&pound;": "£",
  "&times;": "×",
};

export function htmlToText(value: string | null): string {
  if (value === null || value.trim() === "") {
    return "";
  }

  let text = value;

  text = text.replace(HIDDEN_ELEMENTS, " ");
  text = text.replace(COMMENTS, " ");
  text = text.replace(BLOCK_ELEMENTS, "\n");
  text = text.replace(ANY_TAG, "");

  text = decodeHtmlEntities(text);

  text = text.replace(HORIZONTAL_SPACE, " ");
  text = text.replace(SPACE_AROUND_BREAKS, "\n");
  text = text.replace(EXCESS_BREAKS, "\n\n");

  return text.trim();
}

function decodeHtmlEntities(value: string): string {
  let text = decodeXmlEntities(value);

  for (const [entity, character] of Object.entries(HTML_ENTITIES)) {
    if (text.includes(entity)) {
      text = text.split(entity).join(character);
    }
  }

  return text;
}
