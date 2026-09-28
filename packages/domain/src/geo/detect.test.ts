/**
 * Tests for country detection.
 */

import { describe, expect, it } from "vitest";
import { type CountryCode, detectCountry } from "./detect.js";

const RU_HTML = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <title>Магазин</title>
</head>
<body>
  <p>Цена: 1000 ₽</p>
  <p>Телефон: +7 999 123 45 67</p>
  <a href="https://wildberries.ru">Wildberries</a>
  <p>г. Москва, ул. Тверская, 10</p>
</body>
</html>
`;

const US_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>SaaS Pricing</title>
</head>
<body>
  <p>Price: $99/month</p>
  <p>Phone: +1 415 555 0123</p>
  <a href="https://amazon.com">Amazon</a>
</body>
</html>
`;

const DE_HTML = `
<!DOCTYPE html>
<html lang="de">
<head>
  <title>Preise</title>
</head>
<body>
  <p>Preis: 99 €</p>
  <p>Telefon: +49 30 12345678</p>
</body>
</html>
`;

const UK_HTML = `
<!DOCTYPE html>
<html lang="en-GB">
<head>
  <title>Pricing</title>
</head>
<body>
  <p>Price: £79</p>
  <p>Phone: +44 20 7123 4567</p>
</body>
</html>
`;

const KZ_HTML = `
<!DOCTYPE html>
<html lang="kk">
<head>
  <title>Сату</title>
</head>
<body>
  <p>Бағасы: 50000 ₸</p>
  <p>Телефон: +7 701 123 45 67</p>
  <a href="https://kaspi.kz">Kaspi</a>
</body>
</html>
`;

const NEUTRAL_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Neutral Site</title>
</head>
<body>
  <p>Welcome to our site</p>
</body>
</html>
`;

const WB_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Shop</title>
</head>
<body>
  <a href="https://wildberries.ru/catalog">Catalog</a>
</body>
</html>
`;

const CONFLICT_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <title>Shop</title>
</head>
<body>
  <p>Price: 1000 ₽</p>
</body>
</html>
`;

describe("detectCountry", () => {
  it("detects RU from .ru TLD, lang=ru, ₽, +7, wildberries, Russian address", () => {
    const result = detectCountry("https://example.ru", RU_HTML, null);
    expect(result.country).toBe("RU");
    expect(result.confidence).toBe("high");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("detects US from .com TLD, lang=en, $, +1", () => {
    const result = detectCountry("https://example.com", US_HTML, null);
    expect(result.country).toBe("US");
    expect(result.confidence).toBe("high");
  });

  it("detects DE from .de TLD, lang=de, €", () => {
    const result = detectCountry("https://example.de", DE_HTML, null);
    expect(result.country).toBe("DE");
    expect(result.confidence).toBe("high");
  });

  it("detects GB from .co.uk TLD, lang=en-GB, £", () => {
    const result = detectCountry("https://example.co.uk", UK_HTML, null);
    expect(result.country).toBe("GB");
    expect(result.confidence).toBe("high");
  });

  it("detects KZ from .kz TLD, lang=kk, ₸, +7, kaspi.kz", () => {
    const result = detectCountry("https://example.kz", KZ_HTML, null);
    expect(result.country).toBe("KZ");
    expect(result.confidence).toBe("high");
  });

  it("returns null/low for neutral .io site with no signals", () => {
    const result = detectCountry("https://example.io", NEUTRAL_HTML, null);
    expect(result.country).toBeNull();
    expect(result.confidence).toBe("none");
  });

  it("detects RU from wildberries link even with neutral TLD", () => {
    const result = detectCountry("https://example.io", WB_HTML, null);
    expect(result.country).toBe("RU");
    expect(result.confidence).toBe("low");
  });

  it("detects RU from currency conflict (lang=en + ₽)", () => {
    const result = detectCountry("https://example.com", CONFLICT_HTML, null);
    expect(result.country).toBe("RU");
    expect(result.confidence).toBe("low");
  });

  it("uses model country when no signals but model provides country", () => {
    const result = detectCountry("https://example.io", NEUTRAL_HTML, "RU" as CountryCode);
    expect(result.country).toBe("RU");
    // No independent signals → low confidence even with model suggestion
    expect(result.confidence).toBe("low");
  });

  it("prefers detected country over model when they disagree", () => {
    const result = detectCountry("https://example.ru", RU_HTML, "US" as CountryCode);
    expect(result.country).toBe("RU");
    expect(result.confidence).toBe("high");
  });

  it("handles empty HTML", () => {
    const result = detectCountry("https://example.com", "", null);
    expect(result.confidence).toBe("none");
  });

  it("handles invalid URL but valid HTML content", () => {
    const result = detectCountry("not-a-url", RU_HTML, null);
    // Invalid URL but strong HTML signals → high confidence based on content
    expect(result.confidence).toBe("high");
    expect(result.country).toBe("RU");
  });
});
