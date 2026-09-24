/**
 * Keeping advice out of "why this touches you".
 *
 * The implication block explains consequences; it does not tell a business
 * owner what to do. The prompt says so, and this checks it, because a prompt
 * is a request and a model under pressure from persuasive material does not
 * always honour it. An implication that opens with an order is discarded, not
 * rewritten — rewriting would be the code putting words in the model's mouth.
 */

/**
 * Openings that turn an explanation into an instruction, in both languages the
 * product writes. Matched against the first words, case-insensitively. Not
 * exhaustive and not meant to be: the prompt does most of the work, this
 * catches the common failure.
 */
const DIRECTIVE_OPENINGS: readonly string[] = [
  // English imperatives and advice
  "raise",
  "lower",
  "cancel",
  "fix",
  "contact",
  "consider",
  "review",
  "update",
  "switch",
  "increase",
  "decrease",
  "reduce",
  "check",
  "ensure",
  "make sure",
  "monitor",
  "prepare",
  "act",
  "reach out",
  "you should",
  "you must",
  "you need to",
  "we recommend",
  "it is recommended",
  // Russian imperatives and advice
  "повысь",
  "повысьте",
  "снизь",
  "снизьте",
  "отмени",
  "отмените",
  "свяжись",
  "свяжитесь",
  "проверь",
  "проверьте",
  "рассмотри",
  "рассмотрите",
  "обнови",
  "обновите",
  "подготовь",
  "подготовьтесь",
  "следует",
  "нужно",
  "необходимо",
  "рекомендуем",
  "тебе стоит",
  "вам стоит",
];

/** The directive the text opens with, or null. */
export function findDirective(text: string): string | null {
  const opening = text
    .trim()
    .toLowerCase()
    .replace(/^[\s"'«„“*\-–—•]+/u, "");

  for (const directive of DIRECTIVE_OPENINGS) {
    if (!opening.startsWith(directive)) continue;
    const next = opening.charAt(directive.length);
    // Whole words only: "act" must not match "actually".
    if (next === "" || /[\s,.:;!]/u.test(next)) return directive;
  }

  return null;
}
