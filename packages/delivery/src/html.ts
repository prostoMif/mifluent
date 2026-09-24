/**
 * Escaping for Telegram's HTML parse mode.
 *
 * Everything in a digest that came from a source — headlines, quotes, a
 * target's name — is untrusted text. Telegram's HTML mode understands `<`, `>`
 * and `&`; escaping those three (and `"` for attribute values) is what keeps a
 * headline from becoming a link or breaking the message.
 */

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character] ?? character);
}

/** A link, or plain escaped text when there is no safe address. */
export function link(href: string | null, label: string): string {
  if (href === null) return escapeHtml(label);
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}
