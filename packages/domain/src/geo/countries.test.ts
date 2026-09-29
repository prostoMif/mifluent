/**
 * Tests for the countries module.
 */

import { describe, expect, it } from "vitest";
import {
  getCountry,
  getCountryName,
  getDefaultHomeCountry,
  getFlagEmoji,
  getMarket,
  isValidCountryCode,
} from "./countries.js";

describe("countries", () => {
  describe("getCountry", () => {
    it("returns country for known code", () => {
      const country = getCountry("RU");
      expect(country).toBeDefined();
      expect(country?.code).toBe("RU");
      expect(country?.nameRu).toBe("Россия");
      expect(country?.nameEn).toBe("Russia");
      expect(country?.market).toBe("ru");
      expect(country?.regions).toBeDefined();
    });

    it("returns undefined for unknown code", () => {
      expect(getCountry("XX")).toBeUndefined();
    });

    it("is case-sensitive", () => {
      expect(getCountry("ru")).toBeUndefined();
      expect(getCountry("RU")).toBeDefined();
    });
  });

  describe("isValidCountryCode", () => {
    it("returns true for valid codes", () => {
      expect(isValidCountryCode("RU")).toBe(true);
      expect(isValidCountryCode("US")).toBe(true);
      expect(isValidCountryCode("DE")).toBe(true);
    });

    it("returns false for invalid codes", () => {
      expect(isValidCountryCode("XX")).toBe(false);
      expect(isValidCountryCode("")).toBe(false);
    });
  });

  describe("getMarket", () => {
    it("returns 'ru' for RU market countries", () => {
      expect(getMarket("RU")).toBe("ru");
      expect(getMarket("BY")).toBe("ru");
      expect(getMarket("KZ")).toBe("ru");
      expect(getMarket("UZ")).toBe("ru");
      expect(getMarket("KG")).toBe("ru");
      expect(getMarket("TJ")).toBe("ru");
      expect(getMarket("TM")).toBe("ru");
      expect(getMarket("AM")).toBe("ru");
      expect(getMarket("AZ")).toBe("ru");
      expect(getMarket("MD")).toBe("ru");
      expect(getMarket("GE")).toBe("ru");
    });

    it("returns 'en' for EN market countries", () => {
      expect(getMarket("US")).toBe("en");
      expect(getMarket("GB")).toBe("en");
      expect(getMarket("DE")).toBe("en");
      expect(getMarket("FR")).toBe("en");
      expect(getMarket("CN")).toBe("en");
      expect(getMarket("JP")).toBe("en");
    });

    it("defaults to 'en' for unknown codes", () => {
      expect(getMarket("XX")).toBe("en");
    });
  });

  describe("getCountryName", () => {
    it("returns Russian name for 'ru'", () => {
      expect(getCountryName("RU", "ru")).toBe("Россия");
      expect(getCountryName("US", "ru")).toBe("США");
      expect(getCountryName("DE", "ru")).toBe("Германия");
    });

    it("returns English name for 'en'", () => {
      expect(getCountryName("RU", "en")).toBe("Russia");
      expect(getCountryName("US", "en")).toBe("United States");
      expect(getCountryName("DE", "en")).toBe("Germany");
    });

    it("returns code for unknown country", () => {
      expect(getCountryName("XX", "ru")).toBe("XX");
      expect(getCountryName("XX", "en")).toBe("XX");
    });
  });

  describe("getFlagEmoji", () => {
    it("returns flag emoji for valid codes", () => {
      expect(getFlagEmoji("RU")).toBe("🇷🇺");
      expect(getFlagEmoji("US")).toBe("🇺🇸");
      expect(getFlagEmoji("DE")).toBe("🇩🇪");
    });

    it("returns empty string for invalid length", () => {
      expect(getFlagEmoji("R")).toBe("");
      expect(getFlagEmoji("RUS")).toBe("");
      expect(getFlagEmoji("")).toBe("");
    });
  });

  describe("getMarket", () => {
    it("returns 'ru' for RU market countries", () => {
      expect(getMarket("RU")).toBe("ru");
      expect(getMarket("BY")).toBe("ru");
      expect(getMarket("KZ")).toBe("ru");
      expect(getMarket("UZ")).toBe("ru");
      expect(getMarket("KG")).toBe("ru");
      expect(getMarket("TJ")).toBe("ru");
      expect(getMarket("TM")).toBe("ru");
      expect(getMarket("AM")).toBe("ru");
      expect(getMarket("AZ")).toBe("ru");
      expect(getMarket("MD")).toBe("ru");
      expect(getMarket("GE")).toBe("ru");
    });

    it("returns 'en' for EN market countries", () => {
      expect(getMarket("US")).toBe("en");
      expect(getMarket("GB")).toBe("en");
      expect(getMarket("DE")).toBe("en");
      expect(getMarket("FR")).toBe("en");
      expect(getMarket("CN")).toBe("en");
      expect(getMarket("JP")).toBe("en");
    });

    it("defaults to 'en' for unknown codes", () => {
      expect(getMarket("XX")).toBe("en");
    });
  });

  describe("getDefaultHomeCountry", () => {
    it("returns the same country as default home country", () => {
      expect(getDefaultHomeCountry("RU")).toBe("RU");
      expect(getDefaultHomeCountry("US")).toBe("US");
      expect(getDefaultHomeCountry("DE")).toBe("DE");
    });
  });
});
