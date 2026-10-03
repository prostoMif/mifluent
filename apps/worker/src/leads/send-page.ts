/**
 * One HTML page per run: a card per lead with its message and one-click
 * buttons — WhatsApp with the text already filled in, Telegram, e-mail, copy.
 * A person presses send on every message; nothing goes out by itself.
 */

import type { Lead } from "./two-gis-csv.js";
import { whatsappNumber } from "./two-gis-csv.js";

export interface SendCard {
  readonly lead: Lead;
  readonly message: string;
  readonly findings: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function telegramLink(value: string | null): string | null {
  if (value === null) return null;
  if (/^https?:\/\/t\.me\//i.test(value)) return value;
  const handle = value.replace(/^@/, "");
  return /^[A-Za-z0-9_]{4,}$/.test(handle) ? `https://t.me/${handle}` : null;
}

function button(href: string | null, label: string): string {
  if (href === null) return "";
  return `<a class="btn" href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
}

function card(item: SendCard, index: number): string {
  const { lead, message } = item;
  const wa = whatsappNumber(lead);
  const mail =
    lead.email === null
      ? null
      : `mailto:${lead.email}?subject=${encodeURIComponent(`Конкуренты «${lead.name}»: что у них сейчас`)}&body=${encodeURIComponent(message)}`;
  return `<section class="card" id="lead-${index}">
  <header><input type="checkbox" title="Отправлено"> <b>${escapeHtml(lead.name)}</b>
  <span class="muted">${escapeHtml(lead.rubrics)} · ${lead.rating ?? "—"}★ ${lead.reviews} отз. · находок: ${item.findings}</span></header>
  <div class="muted">${escapeHtml(lead.address)} · ${escapeHtml(lead.phone ?? "")} ${lead.website === null ? "" : `· <a href="${escapeHtml(lead.website)}" target="_blank" rel="noopener">сайт</a>`}</div>
  <textarea rows="10">${escapeHtml(message)}</textarea>
  <div class="actions">
    ${button(wa === null ? null : `https://wa.me/${wa}?text=${encodeURIComponent(message)}`, "WhatsApp")}
    ${button(telegramLink(lead.telegram), "Telegram")}
    ${button(mail, "Почта")}
    <button class="btn" onclick="navigator.clipboard.writeText(this.closest('section').querySelector('textarea').value)">Копировать</button>
  </div>
</section>`;
}

export function renderSendPage(cards: readonly SendCard[]): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Лиды Mifluent</title>
<style>
:root{--bg:#fff;--fg:#111;--muted:#666;--line:#ddd;--accent:#1a7f37}
@media (prefers-color-scheme: dark){:root{--bg:#111;--fg:#eee;--muted:#999;--line:#333;--accent:#3fb950}}
body{background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif;max-width:820px;margin:0 auto;padding:16px}
.card{border:1px solid var(--line);border-radius:10px;padding:12px;margin:12px 0}
.card:has(input:checked){opacity:.45}
.muted{color:var(--muted);font-size:13px;margin:4px 0}
textarea{width:100%;box-sizing:border-box;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.btn{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:7px 12px;text-decoration:none;font:inherit;cursor:pointer}
</style></head><body>
<h1>Лиды: ${cards.length}</h1>
<p class="muted">Поправь текст при желании → кнопка канала → отправить → галочка. Не больше 30–40 сообщений в WhatsApp в день с одного номера.</p>
${cards.map(card).join("\n")}
</body></html>
`;
}
