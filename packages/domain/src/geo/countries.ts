/**
 * ISO 3166-1 alpha-2 country codes with Russian/English names, market groups, and regions.
 *
 * Source: ISO 3166-1. Only codes relevant for CIS/US/EU markets are listed with full data;
 * the rest have minimal entries to pass validation.
 */

export type CountryCode = string & { readonly __brand: unique symbol };

export type Market = "ru" | "en";

export interface Country {
  readonly code: CountryCode;
  readonly nameRu: string;
  readonly nameEn: string;
  readonly market: Market;
  /** ISO 3166-2 region codes for this country (top-level only). */
  readonly regions?: readonly string[];
}

/** ISO 3166-2:RU region codes (federal districts / major subjects). */
const RU_REGIONS = [
  "MOW", // Москва
  "SPE", // Санкт-Петербург
  "KDA", // Краснодарский край
  "KYA", // Красноярский край
  "PRI", // Приморский край
  "STA", // Ставропольский край
  "KHA", // Хабаровский край
  "ALT", // Алтайский край
  "ZAB", // Забайкальский край
  "KAM", // Камчатский край
  "MAG", // Магаданская обл.
  "SAK", // Сахалинская обл.
  "EVE", // Еврейская обл.
  "NEN", // Ненецкий АО
  "KHM", // ХМАО
  "YAN", // ЯНАО
  "CHU", // Чукотский АО
  "ADY", // Адыгея
  "ALT", // Алтай
  "BUR", // Бурятия
  "DAG", // Дагестан
  "INU", // Ингушетия
  "KAB", // Кабардино-Балкария
  "KAL", // Калмыкия
  "KCH", // Карачаево-Черкесия
  "KRL", // Карелия
  "KOS", // Коми
  "KKR", // Крым
  "MAR", // Марий Эл
  "MOR", // Мордовия
  "SAK", // Саха (Якутия)
  "SEV", // Северная Осетия
  "TAT", // Татарстан
  "TYV", // Тыва
  "UDM", // Удмуртия
  "KHA", // Хакасия
  "CHE", // Чечня
  "CHV", // Чувашия
] as const;

/** ISO 3166-2:KZ region codes (major). */
const KZ_REGIONS = [
  "ALA", // Алматинская обл.
  "AKM", // Ақмола обл.
  "AKT", // Ақтөбе обл.
  "ALM", // Алматы (город)
  "AST", // Астана (город)
  "ATY", // Атырау обл.
  "BAY", // Баяқоңыр обл.
  "ZHA", // Жамбыл обл.
  "ZHE", // Жетикара обл.
  "KAR", // Қарағанды обл.
  "KUS", // Қостанай обл.
  "KZY", // Қызылорда обл.
  "MAN", // Маңғыстау обл.
  "PAV", // Павлодар обл.
  "SOL", // Солтүстік Қазақстан обл.
  "TUR", // Түркістан обл.
  "ULY", // Ұлытау обл.
  "SHY", // Шымкент (город)
  "ABA", // Абай обл.
  "JET", // Жетісу обл.
] as const;

/** ISO 3166-2:US region codes (states). */
const US_REGIONS = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

/** Map of all known countries by alpha-2 code. */
export const COUNTRIES: ReadonlyMap<CountryCode, Country> = new Map<CountryCode, Country>([
  // RU market (CIS)
  [
    "RU" as CountryCode,
    {
      code: "RU" as CountryCode,
      nameRu: "Россия",
      nameEn: "Russia",
      market: "ru",
      regions: RU_REGIONS,
    },
  ],
  [
    "BY" as CountryCode,
    { code: "BY" as CountryCode, nameRu: "Беларусь", nameEn: "Belarus", market: "ru" },
  ],
  [
    "KZ" as CountryCode,
    {
      code: "KZ" as CountryCode,
      nameRu: "Казахстан",
      nameEn: "Kazakhstan",
      market: "ru",
      regions: KZ_REGIONS,
    },
  ],
  [
    "UZ" as CountryCode,
    { code: "UZ" as CountryCode, nameRu: "Узбекистан", nameEn: "Uzbekistan", market: "ru" },
  ],
  [
    "KG" as CountryCode,
    { code: "KG" as CountryCode, nameRu: "Кыргызстан", nameEn: "Kyrgyzstan", market: "ru" },
  ],
  [
    "TJ" as CountryCode,
    { code: "TJ" as CountryCode, nameRu: "Таджикистан", nameEn: "Tajikistan", market: "ru" },
  ],
  [
    "TM" as CountryCode,
    { code: "TM" as CountryCode, nameRu: "Туркменистан", nameEn: "Turkmenistan", market: "ru" },
  ],
  [
    "AM" as CountryCode,
    { code: "AM" as CountryCode, nameRu: "Армения", nameEn: "Armenia", market: "ru" },
  ],
  [
    "AZ" as CountryCode,
    { code: "AZ" as CountryCode, nameRu: "Азербайджан", nameEn: "Azerbaijan", market: "ru" },
  ],
  [
    "MD" as CountryCode,
    { code: "MD" as CountryCode, nameRu: "Молдова", nameEn: "Moldova", market: "ru" },
  ],
  [
    "GE" as CountryCode,
    { code: "GE" as CountryCode, nameRu: "Грузия", nameEn: "Georgia", market: "ru" },
  ],

  // EN market (major English-speaking + EU)
  [
    "US" as CountryCode,
    {
      code: "US" as CountryCode,
      nameRu: "США",
      nameEn: "United States",
      market: "en",
      regions: US_REGIONS,
    },
  ],
  [
    "GB" as CountryCode,
    { code: "GB" as CountryCode, nameRu: "Великобритания", nameEn: "United Kingdom", market: "en" },
  ],
  [
    "CA" as CountryCode,
    { code: "CA" as CountryCode, nameRu: "Канада", nameEn: "Canada", market: "en" },
  ],
  [
    "AU" as CountryCode,
    { code: "AU" as CountryCode, nameRu: "Австралия", nameEn: "Australia", market: "en" },
  ],
  [
    "NZ" as CountryCode,
    { code: "NZ" as CountryCode, nameRu: "Новая Зеландия", nameEn: "New Zealand", market: "en" },
  ],
  [
    "IE" as CountryCode,
    { code: "IE" as CountryCode, nameRu: "Ирландия", nameEn: "Ireland", market: "en" },
  ],

  // EU
  [
    "DE" as CountryCode,
    { code: "DE" as CountryCode, nameRu: "Германия", nameEn: "Germany", market: "en" },
  ],
  [
    "FR" as CountryCode,
    { code: "FR" as CountryCode, nameRu: "Франция", nameEn: "France", market: "en" },
  ],
  [
    "ES" as CountryCode,
    { code: "ES" as CountryCode, nameRu: "Испания", nameEn: "Spain", market: "en" },
  ],
  [
    "IT" as CountryCode,
    { code: "IT" as CountryCode, nameRu: "Италия", nameEn: "Italy", market: "en" },
  ],
  [
    "NL" as CountryCode,
    { code: "NL" as CountryCode, nameRu: "Нидерланды", nameEn: "Netherlands", market: "en" },
  ],
  [
    "BE" as CountryCode,
    { code: "BE" as CountryCode, nameRu: "Бельгия", nameEn: "Belgium", market: "en" },
  ],
  [
    "AT" as CountryCode,
    { code: "AT" as CountryCode, nameRu: "Австрия", nameEn: "Austria", market: "en" },
  ],
  [
    "PL" as CountryCode,
    { code: "PL" as CountryCode, nameRu: "Польша", nameEn: "Poland", market: "en" },
  ],
  [
    "CZ" as CountryCode,
    { code: "CZ" as CountryCode, nameRu: "Чехия", nameEn: "Czechia", market: "en" },
  ],
  [
    "SE" as CountryCode,
    { code: "SE" as CountryCode, nameRu: "Швеция", nameEn: "Sweden", market: "en" },
  ],
  [
    "FI" as CountryCode,
    { code: "FI" as CountryCode, nameRu: "Финляндия", nameEn: "Finland", market: "en" },
  ],
  [
    "DK" as CountryCode,
    { code: "DK" as CountryCode, nameRu: "Дания", nameEn: "Denmark", market: "en" },
  ],
  [
    "PT" as CountryCode,
    { code: "PT" as CountryCode, nameRu: "Португалия", nameEn: "Portugal", market: "en" },
  ],
  [
    "GR" as CountryCode,
    { code: "GR" as CountryCode, nameRu: "Греция", nameEn: "Greece", market: "en" },
  ],
  [
    "HU" as CountryCode,
    { code: "HU" as CountryCode, nameRu: "Венгрия", nameEn: "Hungary", market: "en" },
  ],
  [
    "RO" as CountryCode,
    { code: "RO" as CountryCode, nameRu: "Румыния", nameEn: "Romania", market: "en" },
  ],
  [
    "BG" as CountryCode,
    { code: "BG" as CountryCode, nameRu: "Болгария", nameEn: "Bulgaria", market: "en" },
  ],
  [
    "HR" as CountryCode,
    { code: "HR" as CountryCode, nameRu: "Хорватия", nameEn: "Croatia", market: "en" },
  ],
  [
    "SK" as CountryCode,
    { code: "SK" as CountryCode, nameRu: "Словакия", nameEn: "Slovakia", market: "en" },
  ],
  [
    "SI" as CountryCode,
    { code: "SI" as CountryCode, nameRu: "Словения", nameEn: "Slovenia", market: "en" },
  ],
  [
    "LT" as CountryCode,
    { code: "LT" as CountryCode, nameRu: "Литва", nameEn: "Lithuania", market: "en" },
  ],
  [
    "LV" as CountryCode,
    { code: "LV" as CountryCode, nameRu: "Латвия", nameEn: "Latvia", market: "en" },
  ],
  [
    "EE" as CountryCode,
    { code: "EE" as CountryCode, nameRu: "Эстония", nameEn: "Estonia", market: "en" },
  ],

  // Other major
  [
    "CN" as CountryCode,
    { code: "CN" as CountryCode, nameRu: "Китай", nameEn: "China", market: "en" },
  ],
  [
    "JP" as CountryCode,
    { code: "JP" as CountryCode, nameRu: "Япония", nameEn: "Japan", market: "en" },
  ],
  [
    "IN" as CountryCode,
    { code: "IN" as CountryCode, nameRu: "Индия", nameEn: "India", market: "en" },
  ],
  [
    "BR" as CountryCode,
    { code: "BR" as CountryCode, nameRu: "Бразилия", nameEn: "Brazil", market: "en" },
  ],
  [
    "MX" as CountryCode,
    { code: "MX" as CountryCode, nameRu: "Мексика", nameEn: "Mexico", market: "en" },
  ],
  [
    "SG" as CountryCode,
    { code: "SG" as CountryCode, nameRu: "Сингапур", nameEn: "Singapore", market: "en" },
  ],
  [
    "HK" as CountryCode,
    { code: "HK" as CountryCode, nameRu: "Гонконг", nameEn: "Hong Kong", market: "en" },
  ],
  [
    "AE" as CountryCode,
    { code: "AE" as CountryCode, nameRu: "ОАЭ", nameEn: "United Arab Emirates", market: "en" },
  ],
  [
    "IL" as CountryCode,
    { code: "IL" as CountryCode, nameRu: "Израиль", nameEn: "Israel", market: "en" },
  ],
  [
    "TR" as CountryCode,
    { code: "TR" as CountryCode, nameRu: "Турция", nameEn: "Turkey", market: "en" },
  ],
  [
    "SA" as CountryCode,
    {
      code: "SA" as CountryCode,
      nameRu: "Саудовская Аравия",
      nameEn: "Saudi Arabia",
      market: "en",
    },
  ],
  [
    "CH" as CountryCode,
    { code: "CH" as CountryCode, nameRu: "Швейцария", nameEn: "Switzerland", market: "en" },
  ],
  [
    "NO" as CountryCode,
    { code: "NO" as CountryCode, nameRu: "Норвегия", nameEn: "Norway", market: "en" },
  ],
  [
    "IS" as CountryCode,
    { code: "IS" as CountryCode, nameRu: "Исландия", nameEn: "Iceland", market: "en" },
  ],
]);

/** Returns country by alpha-2 code, or undefined if unknown. */
export function getCountry(code: string): Country | undefined {
  return COUNTRIES.get(code as CountryCode);
}

/** Returns true if code is a valid ISO alpha-2 in our list. */
export function isValidCountryCode(code: string): boolean {
  return COUNTRIES.has(code as CountryCode);
}

/** Returns the market for a country code (defaults to "en" for unknown). */
export function getMarket(code: string): Market {
  return COUNTRIES.get(code as CountryCode)?.market ?? "en";
}

/** Returns the default home country (same as country). */
export function getDefaultHomeCountry(country: string): string {
  return country;
}

/** Returns country name in given language. */
export function getCountryName(code: string, language: "ru" | "en"): string {
  const c = COUNTRIES.get(code as CountryCode);
  if (!c) return code;
  return language === "ru" ? c.nameRu : c.nameEn;
}

/** Returns emoji flag for a country code (regional indicator symbols). */
export function getFlagEmoji(code: string): string {
  if (code.length !== 2) return "";
  const offset = 127397;
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => c.charCodeAt(0) + offset),
  );
}
