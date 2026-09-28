/**
 * Country detection from website HTML and URL.
 *
 * Pure functions, no network calls. Weights and heuristics based on common
 * signals: TLD, html lang, currency symbols, phone prefixes, addresses,
 * local marketplace links.
 */

export type { CountryCode } from "./countries.js";

import type { CountryCode } from "./countries.js";

export type Confidence = "high" | "low" | "none";

export interface DetectResult {
  readonly country: CountryCode | null;
  readonly confidence: Confidence;
  readonly reasons: readonly string[];
}

interface Signal {
  country: CountryCode;
  weight: number;
}

const TLD_MAP: ReadonlyMap<string, CountryCode> = new Map([
  ["ru", "RU" as CountryCode],
  ["рф", "RU" as CountryCode],
  ["su", "RU" as CountryCode],
  ["by", "BY" as CountryCode],
  ["kz", "KZ" as CountryCode],
  ["uz", "UZ" as CountryCode],
  ["kg", "KG" as CountryCode],
  ["tj", "TJ" as CountryCode],
  ["tm", "TM" as CountryCode],
  ["am", "AM" as CountryCode],
  ["az", "AZ" as CountryCode],
  ["md", "MD" as CountryCode],
  ["ge", "GE" as CountryCode],
  ["de", "DE" as CountryCode],
  ["fr", "FR" as CountryCode],
  ["es", "ES" as CountryCode],
  ["it", "IT" as CountryCode],
  ["nl", "NL" as CountryCode],
  ["be", "BE" as CountryCode],
  ["at", "AT" as CountryCode],
  ["pl", "PL" as CountryCode],
  ["cz", "CZ" as CountryCode],
  ["se", "SE" as CountryCode],
  ["fi", "FI" as CountryCode],
  ["dk", "DK" as CountryCode],
  ["pt", "PT" as CountryCode],
  ["gr", "GR" as CountryCode],
  ["hu", "HU" as CountryCode],
  ["ro", "RO" as CountryCode],
  ["bg", "BG" as CountryCode],
  ["hr", "HR" as CountryCode],
  ["sk", "SK" as CountryCode],
  ["si", "SI" as CountryCode],
  ["lt", "LT" as CountryCode],
  ["lv", "LV" as CountryCode],
  ["ee", "EE" as CountryCode],
  ["gb", "GB" as CountryCode],
  ["uk", "GB" as CountryCode],
  ["co.uk", "GB" as CountryCode],
  ["ca", "CA" as CountryCode],
  ["au", "AU" as CountryCode],
  ["nz", "NZ" as CountryCode],
  ["ie", "IE" as CountryCode],
  ["jp", "JP" as CountryCode],
  ["cn", "CN" as CountryCode],
  ["in", "IN" as CountryCode],
  ["br", "BR" as CountryCode],
  ["mx", "MX" as CountryCode],
  ["sg", "SG" as CountryCode],
  ["hk", "HK" as CountryCode],
  ["ae", "AE" as CountryCode],
  ["il", "IL" as CountryCode],
  ["tr", "TR" as CountryCode],
  ["sa", "SA" as CountryCode],
  ["ch", "CH" as CountryCode],
  ["no", "NO" as CountryCode],
  ["is", "IS" as CountryCode],
]);

const LANG_MAP: ReadonlyMap<string, CountryCode> = new Map([
  ["ru", "RU" as CountryCode],
  ["be", "BY" as CountryCode],
  ["uk", "UA" as CountryCode],
  ["kk", "KZ" as CountryCode],
  ["uz", "UZ" as CountryCode],
  ["ky", "KG" as CountryCode],
  ["tg", "TJ" as CountryCode],
  ["tk", "TM" as CountryCode],
  ["hy", "AM" as CountryCode],
  ["az", "AZ" as CountryCode],
  ["ro", "MD" as CountryCode],
  ["ka", "GE" as CountryCode],
  ["de", "DE" as CountryCode],
  ["fr", "FR" as CountryCode],
  ["es", "ES" as CountryCode],
  ["it", "IT" as CountryCode],
  ["nl", "NL" as CountryCode],
  ["pl", "PL" as CountryCode],
  ["cs", "CZ" as CountryCode],
  ["sv", "SE" as CountryCode],
  ["fi", "FI" as CountryCode],
  ["da", "DK" as CountryCode],
  ["pt", "PT" as CountryCode],
  ["el", "GR" as CountryCode],
  ["hu", "HU" as CountryCode],
  ["ro", "RO" as CountryCode],
  ["bg", "BG" as CountryCode],
  ["hr", "HR" as CountryCode],
  ["sk", "SK" as CountryCode],
  ["sl", "SI" as CountryCode],
  ["lt", "LT" as CountryCode],
  ["lv", "LV" as CountryCode],
  ["et", "EE" as CountryCode],
  ["en-us", "US" as CountryCode],
  ["en-gb", "GB" as CountryCode],
  ["en-ca", "CA" as CountryCode],
  ["en-au", "AU" as CountryCode],
]);

const CURRENCY_MAP: ReadonlyMap<string, CountryCode> = new Map([
  ["₽", "RU" as CountryCode],
  ["руб", "RU" as CountryCode],
  ["руб.", "RU" as CountryCode],
  ["$", "US" as CountryCode],
  ["€", "DE" as CountryCode],
  ["£", "GB" as CountryCode],
  ["¥", "JP" as CountryCode],
  ["₹", "IN" as CountryCode],
  ["₩", "KR" as CountryCode],
  ["₺", "TR" as CountryCode],
  ["₴", "UA" as CountryCode],
  ["₸", "KZ" as CountryCode],
  ["₾", "GE" as CountryCode],
  ["₼", "AZ" as CountryCode],
  ["лв", "BG" as CountryCode],
  ["kn", "HR" as CountryCode],
  ["czk", "CZ" as CountryCode],
  ["dkk", "DK" as CountryCode],
  ["hrk", "HR" as CountryCode],
  ["huf", "HU" as CountryCode],
  ["pln", "PL" as CountryCode],
  ["ron", "RO" as CountryCode],
  ["sek", "SE" as CountryCode],
  ["chf", "CH" as CountryCode],
  ["nok", "NO" as CountryCode],
  ["isk", "IS" as CountryCode],
]);

const PHONE_PREFIX_MAP: ReadonlyMap<string, readonly CountryCode[]> = new Map([
  ["+7", ["RU" as CountryCode, "KZ" as CountryCode]],
  ["+1", ["US" as CountryCode, "CA" as CountryCode]],
  ["+44", ["GB" as CountryCode]],
  ["+49", ["DE" as CountryCode]],
  ["+33", ["FR" as CountryCode]],
  ["+34", ["ES" as CountryCode]],
  ["+39", ["IT" as CountryCode]],
  ["+31", ["NL" as CountryCode]],
  ["+32", ["BE" as CountryCode]],
  ["+43", ["AT" as CountryCode]],
  ["+48", ["PL" as CountryCode]],
  ["+420", ["CZ" as CountryCode]],
  ["+46", ["SE" as CountryCode]],
  ["+358", ["FI" as CountryCode]],
  ["+45", ["DK" as CountryCode]],
  ["+351", ["PT" as CountryCode]],
  ["+30", ["GR" as CountryCode]],
  ["+36", ["HU" as CountryCode]],
  ["+40", ["RO" as CountryCode]],
  ["+359", ["BG" as CountryCode]],
  ["+385", ["HR" as CountryCode]],
  ["+421", ["SK" as CountryCode]],
  ["+386", ["SI" as CountryCode]],
  ["+370", ["LT" as CountryCode]],
  ["+371", ["LV" as CountryCode]],
  ["+372", ["EE" as CountryCode]],
  ["+7", ["BY" as CountryCode]],
  ["+995", ["GE" as CountryCode]],
  ["+373", ["MD" as CountryCode]],
  ["+374", ["AM" as CountryCode]],
  ["+994", ["AZ" as CountryCode]],
  ["+998", ["UZ" as CountryCode]],
  ["+996", ["KG" as CountryCode]],
  ["+992", ["TJ" as CountryCode]],
  ["+993", ["TM" as CountryCode]],
  ["+86", ["CN" as CountryCode]],
  ["+81", ["JP" as CountryCode]],
  ["+91", ["IN" as CountryCode]],
  ["+55", ["BR" as CountryCode]],
  ["+52", ["MX" as CountryCode]],
  ["+65", ["SG" as CountryCode]],
  ["+852", ["HK" as CountryCode]],
  ["+971", ["AE" as CountryCode]],
  ["+972", ["IL" as CountryCode]],
  ["+90", ["TR" as CountryCode]],
  ["+966", ["SA" as CountryCode]],
  ["+41", ["CH" as CountryCode]],
  ["+47", ["NO" as CountryCode]],
  ["+354", ["IS" as CountryCode]],
]);

const MARKETPLACE_LINKS: ReadonlyArray<{ pattern: RegExp; country: CountryCode }> = [
  { pattern: /wildberries\.(ru|by|kz)/i, country: "RU" as CountryCode },
  { pattern: /ozon\.(ru|by|kz)/i, country: "RU" as CountryCode },
  { pattern: /yandex\.(ru|by|kz)/i, country: "RU" as CountryCode },
  { pattern: /avito\.(ru|by|kz)/i, country: "RU" as CountryCode },
  { pattern: /sberbank\.(ru|by|kz)/i, country: "RU" as CountryCode },
  { pattern: /tinkoff\.(ru|by|kz)/i, country: "RU" as CountryCode },
  { pattern: /amazon\.de/i, country: "DE" as CountryCode },
  { pattern: /amazon\.fr/i, country: "FR" as CountryCode },
  { pattern: /amazon\.co\.uk/i, country: "GB" as CountryCode },
  { pattern: /amazon\.es/i, country: "ES" as CountryCode },
  { pattern: /amazon\.it/i, country: "IT" as CountryCode },
  { pattern: /amazon\.co\.jp/i, country: "JP" as CountryCode },
  { pattern: /mercadolibre\.(com|cl|ar|br|co|mx|uy|ve)/i, country: "BR" as CountryCode },
  { pattern: /taobao\.com/i, country: "CN" as CountryCode },
  { pattern: /tmall\.com/i, country: "CN" as CountryCode },
  { pattern: /jd\.com/i, country: "CN" as CountryCode },
  { pattern: /rakuten\.(co\.jp|com)/i, country: "JP" as CountryCode },
  { pattern: /allegro\.pl/i, country: "PL" as CountryCode },
  { pattern: /olx\.(pl|ua|by|kz)/i, country: "PL" as CountryCode },
  { pattern: /kaspi\.(kz|store)/i, country: "KZ" as CountryCode },
];

const ADDRESS_PATTERNS: ReadonlyArray<{ pattern: RegExp; country: CountryCode }> = [
  {
    pattern:
      /\b(г\.|город|ул\.|улица|пр\.|проспект|пер\.|переулок|ш\.\s*[.-]?\s*ул)\s+[А-Яа-яA-Za-z]/i,
    country: "RU" as CountryCode,
  },
  { pattern: /\b\d{6}\b/, country: "RU" as CountryCode },
  { pattern: /\b(zip|postal)\s*code\s*:?\s*\d{5}(-\d{4})?/i, country: "US" as CountryCode },
  { pattern: /\b\d{5}\s*[A-Z]{2}\b/, country: "US" as CountryCode },
  { pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i, country: "GB" as CountryCode },
  { pattern: /\b\d{5}\b/, country: "DE" as CountryCode },
];

function extractTld(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1];
      if (!lastPart) return null;
      const tld = lastPart.toLowerCase();
      if (
        parts.length >= 3 &&
        (parts[parts.length - 2] === "co" ||
          parts[parts.length - 2] === "com" ||
          parts[parts.length - 2] === "org")
      ) {
        const secondLast = parts[parts.length - 2];
        if (!secondLast) return tld;
        return `${secondLast}.${tld}`;
      }
      return tld;
    }
  } catch {
    // ignore
  }
  return null;
}

function extractHtmlLang(html: string): string | null {
  const match = html.match(/<html[^>]*lang\s*=\s*["']([^"']+)["']/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function findCurrency(html: string): string[] {
  const found: string[] = [];
  for (const symbol of CURRENCY_MAP.keys()) {
    if (html.includes(symbol)) {
      found.push(symbol);
    }
  }
  return found;
}

function findPhonePrefixes(html: string): string[] {
  const found: string[] = [];
  for (const prefix of PHONE_PREFIX_MAP.keys()) {
    const regex = new RegExp(`${prefix.replace("+", "\\+")}\\s?\\d`);
    if (regex.test(html)) {
      found.push(prefix);
    }
  }
  return found;
}

function findMarketplaceLinks(html: string): CountryCode[] {
  const found: CountryCode[] = [];
  for (const { pattern, country } of MARKETPLACE_LINKS) {
    if (pattern.test(html)) {
      found.push(country);
    }
  }
  return found;
}

function findAddressPatterns(html: string): CountryCode[] {
  const found: CountryCode[] = [];
  for (const { pattern, country } of ADDRESS_PATTERNS) {
    if (pattern.test(html)) {
      found.push(country);
    }
  }
  return found;
}

function tallySignals(signals: Signal[]): {
  country: CountryCode | null;
  score: number;
  signalCount: number;
} {
  const totals = new Map<CountryCode, { score: number; count: number }>();
  for (const s of signals) {
    const existing = totals.get(s.country) ?? { score: 0, count: 0 };
    totals.set(s.country, { score: existing.score + s.weight, count: existing.count + 1 });
  }
  let best: CountryCode | null = null;
  let bestScore = 0;
  let bestCount = 0;
  for (const [country, { score, count }] of totals) {
    // Bonus for multiple independent signals: +1 per additional signal
    const adjustedScore = score + Math.max(0, count - 1);
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestCount = count;
      best = country;
    }
  }
  return { country: best, score: bestScore, signalCount: bestCount };
}

function confidenceFromScore(
  score: number,
  modelCountry: CountryCode | null,
  detectedCountry: CountryCode | null,
): Confidence {
  if (score === 0) {
    // No signals at all: if model provided a country, use it with low confidence
    // (no independent verification), otherwise none
    return modelCountry ? "low" : "none";
  }
  if (modelCountry && detectedCountry && modelCountry === detectedCountry) return "high";
  if (score >= 5) return "high";
  // If we have a model country but no detected country to compare, use model with low confidence
  if (!detectedCountry && modelCountry) return "low";
  return "low";
}

function collectTldSignal(url: string): { signal: Signal | null; reason: string | null } {
  const tld = extractTld(url);
  if (!tld) return { signal: null, reason: null };
  const country = TLD_MAP.get(tld);
  if (!country) return { signal: null, reason: null };
  return { signal: { country, weight: 3 }, reason: `TLD .${tld} → ${country}` };
}

function collectLangSignal(html: string): { signal: Signal | null; reason: string | null } {
  const lang = extractHtmlLang(html);
  if (!lang) return { signal: null, reason: null };
  const country = LANG_MAP.get(lang.toLowerCase());
  if (!country) return { signal: null, reason: null };
  return { signal: { country, weight: 2 }, reason: `html lang="${lang}" → ${country}` };
}

function collectCurrencySignals(html: string): { signals: Signal[]; reasons: string[] } {
  const signals: Signal[] = [];
  const reasons: string[] = [];
  const currencies = findCurrency(html);
  for (const symbol of currencies) {
    const country = CURRENCY_MAP.get(symbol);
    if (country) {
      signals.push({ country, weight: 2 });
      reasons.push(`currency "${symbol}" → ${country}`);
    }
  }
  return { signals, reasons };
}

function collectPhoneSignals(html: string): { signals: Signal[]; reasons: string[] } {
  const signals: Signal[] = [];
  const reasons: string[] = [];
  const phones = findPhonePrefixes(html);
  for (const prefix of phones) {
    const countries = PHONE_PREFIX_MAP.get(prefix);
    if (countries) {
      for (const c of countries) {
        signals.push({ country: c, weight: 2 });
      }
      reasons.push(`phone prefix "${prefix}" → ${countries.join(",")}`);
    }
  }
  return { signals, reasons };
}

function collectMarketplaceSignals(html: string): { signals: Signal[]; reasons: string[] } {
  const signals: Signal[] = [];
  const reasons: string[] = [];
  const marketplaces = findMarketplaceLinks(html);
  for (const c of marketplaces) {
    signals.push({ country: c, weight: 3 });
    reasons.push(`marketplace link → ${c}`);
  }
  return { signals, reasons };
}

function collectAddressSignals(html: string): { signals: Signal[]; reasons: string[] } {
  const signals: Signal[] = [];
  const reasons: string[] = [];
  const addresses = findAddressPatterns(html);
  for (const c of addresses) {
    signals.push({ country: c, weight: 2 });
    reasons.push(`address pattern → ${c}`);
  }
  return { signals, reasons };
}

/**
 * Detects country from website URL and HTML.
 *
 * @param url - Website URL (used for TLD extraction)
 * @param html - HTML content of the homepage
 * @param modelCountry - Country code returned by the discovery model (optional)
 * @returns Detection result with country code, confidence, and reasons
 */
export function detectCountry(
  url: string,
  html: string,
  modelCountry: CountryCode | null,
): DetectResult {
  const signals: Signal[] = [];
  const reasons: string[] = [];

  const tldResult = collectTldSignal(url);
  if (tldResult.signal && tldResult.reason) {
    signals.push(tldResult.signal);
    reasons.push(tldResult.reason);
  }

  const langResult = collectLangSignal(html);
  if (langResult.signal && langResult.reason) {
    signals.push(langResult.signal);
    reasons.push(langResult.reason);
  }

  const currencyResult = collectCurrencySignals(html);
  signals.push(...currencyResult.signals);
  reasons.push(...currencyResult.reasons);

  const phoneResult = collectPhoneSignals(html);
  signals.push(...phoneResult.signals);
  reasons.push(...phoneResult.reasons);

  const marketplaceResult = collectMarketplaceSignals(html);
  signals.push(...marketplaceResult.signals);
  reasons.push(...marketplaceResult.reasons);

  const addressResult = collectAddressSignals(html);
  signals.push(...addressResult.signals);
  reasons.push(...addressResult.reasons);

  const { country, score } = tallySignals(signals);
  const confidence = confidenceFromScore(score, modelCountry, country);

  return {
    country: country ?? modelCountry ?? null,
    confidence,
    reasons,
  };
}
