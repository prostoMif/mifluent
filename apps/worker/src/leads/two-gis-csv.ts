/**
 * Reading a 2GIS export (parser-2gis CSV) into leads.
 *
 * The file starts with Excel's `sep=,` hint and a byte-order mark, quotes
 * fields with commas or line breaks in them, and names columns in Russian.
 */

export interface Lead {
  readonly name: string;
  readonly rubrics: string;
  readonly city: string;
  readonly address: string;
  readonly rating: number | null;
  readonly reviews: number;
  readonly website: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly whatsapp: string | null;
  readonly telegram: string | null;
  readonly vk: string | null;
  readonly twoGisUrl: string | null;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field.replace(/\r$/, "")]);
  return rows;
}

function cleanUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function text(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** Leads from the export; rows without a name are skipped. */
export function readTwoGisCsv(content: string): Lead[] {
  const lines = content.replace(/^﻿/, "").replace(/^sep=.\r?\n/, "");
  const [header, ...rows] = parseCsv(lines);
  if (header === undefined) return [];
  const column = (row: readonly string[], name: string): string | undefined => {
    const at = header.indexOf(name);
    return at === -1 ? undefined : row[at];
  };

  return rows.flatMap((row): Lead[] => {
    const name = text(column(row, "Наименование"));
    if (name === null) return [];
    const rating = Number.parseFloat(column(row, "Рейтинг") ?? "");
    const reviews = Number.parseInt(column(row, "Количество отзывов") ?? "", 10);
    return [
      {
        name,
        rubrics: text(column(row, "Рубрики")) ?? "",
        city: text(column(row, "Город")) ?? "",
        address: text(column(row, "Адрес")) ?? "",
        rating: Number.isFinite(rating) ? rating : null,
        reviews: Number.isFinite(reviews) ? reviews : 0,
        website: cleanUrl(column(row, "Веб-сайт 1")),
        email: text(column(row, "E-mail 1"))?.toLowerCase() ?? null,
        phone: text(column(row, "Телефон 1")),
        whatsapp: text(column(row, "WhatsApp 1")),
        telegram: text(column(row, "Telegram")),
        vk: text(column(row, "ВКонтакте")),
        twoGisUrl: text(column(row, "2GIS URL")),
      },
    ];
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The lead's competitors: other businesses from the same export — same city
 * and category, by construction — with a site of their own, best rated first.
 */
export function competitorsFor(lead: Lead, all: readonly Lead[], limit: number): Lead[] {
  const ownHost = lead.website === null ? null : hostOf(lead.website);
  const seen = new Set<string>();
  return all
    .filter((other) => other.website !== null && other.name !== lead.name)
    .filter((other) => {
      const host = hostOf(other.website ?? "");
      if (host === ownHost || seen.has(host)) return false;
      seen.add(host);
      return true;
    })
    .sort(
      (a, b) => (b.rating ?? 0) * Math.log1p(b.reviews) - (a.rating ?? 0) * Math.log1p(a.reviews),
    )
    .slice(0, limit);
}

/** Digits only, Russian 8-prefix turned into 7: what wa.me expects. */
export function whatsappNumber(lead: Lead): string | null {
  const source = lead.whatsapp ?? lead.phone;
  if (source === null) return null;
  const fromLink = /wa\.me\/(\d+)/.exec(source)?.[1];
  const digits = fromLink ?? source.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
}
