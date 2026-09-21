import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";
import { isAppError } from "./errors.js";

const VALID = {
  DATABASE_URL: "postgres://mifluent:mifluent@localhost:5432/mifluent",
  BETTER_AUTH_SECRET: "a".repeat(48),
  BETTER_AUTH_URL: "http://localhost:3000",
  ENCRYPTION_KEY: "b".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("parseConfig", () => {
  it("accepts a minimal valid environment", () => {
    const config = parseConfig(VALID);
    expect(config.DATABASE_URL).toBe(VALID.DATABASE_URL);
  });

  it("applies documented defaults", () => {
    const config = parseConfig(VALID);

    expect(config.WORKER_CONCURRENCY).toBe(4);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.REGISTRATION_OPEN).toBe(false);
    expect(config.DEFAULT_TIMEZONE).toBe("UTC");
    expect(config.DIGEST_DEFAULT_TIME).toBe("07:00");
  });

  it("reports every missing variable at once, not just the first", () => {
    try {
      parseConfig({});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe("configuration_invalid");
        // All five required names should appear in one message.
        for (const name of Object.keys(VALID)) {
          expect(error.message).toContain(name);
        }
      }
    }
  });

  it("refuses a short session secret", () => {
    expect(() => parseConfig({ ...VALID, BETTER_AUTH_SECRET: "too-short" })).toThrow();
  });

  it("refuses a url without a scheme", () => {
    expect(() => parseConfig({ ...VALID, APP_URL: "localhost:3000" })).toThrow();
  });

  it("refuses a malformed delivery time", () => {
    expect(() => parseConfig({ ...VALID, DIGEST_DEFAULT_TIME: "7am" })).toThrow();
    expect(() => parseConfig({ ...VALID, DIGEST_DEFAULT_TIME: "25:00" })).toThrow();
  });

  it("reads booleans the way people actually write them", () => {
    expect(parseConfig({ ...VALID, REGISTRATION_OPEN: "true" }).REGISTRATION_OPEN).toBe(true);
    expect(parseConfig({ ...VALID, REGISTRATION_OPEN: "1" }).REGISTRATION_OPEN).toBe(true);
    expect(parseConfig({ ...VALID, REGISTRATION_OPEN: "YES" }).REGISTRATION_OPEN).toBe(true);
    expect(parseConfig({ ...VALID, REGISTRATION_OPEN: "false" }).REGISTRATION_OPEN).toBe(false);
  });
});

describe("feature derivation", () => {
  it("switches everything off when nothing optional is set", () => {
    const { features } = parseConfig(VALID);

    expect(features).toEqual({
      llm: false,
      telegram: false,
      email: false,
      googleSignIn: false,
      reddit: false,
    });
  });

  it("needs the whole group before a feature counts as configured", () => {
    // A key with no model names cannot make a call, so this must stay off
    // rather than fail later inside the pipeline.
    const partial = parseConfig({ ...VALID, LLM_API_KEY: "sk-test" });
    expect(partial.features.llm).toBe(false);

    const complete = parseConfig({
      ...VALID,
      LLM_API_KEY: "sk-test",
      LLM_MODEL_CHEAP: "cheap-model",
      LLM_MODEL_DEEP: "deep-model",
    });
    expect(complete.features.llm).toBe(true);
  });

  it("switches Telegram on with just a token", () => {
    expect(parseConfig({ ...VALID, TELEGRAM_BOT_TOKEN: "123:abc" }).features.telegram).toBe(true);
  });
});

describe("blank variables", () => {
  it("treats an optional variable left blank as not set", () => {
    // .env.example ships every key present and empty. Before this, an untouched
    // ISSUE_TRACKER_URL stopped the whole process from starting.
    const config = parseConfig({ ...VALID, ISSUE_TRACKER_URL: "" });

    expect(config.ISSUE_TRACKER_URL).toBeUndefined();
  });

  it("falls back to the default when a tuning variable is blank", () => {
    expect(parseConfig({ ...VALID, LOG_LEVEL: "" }).LOG_LEVEL).toBe("info");
  });

  it("treats whitespace as blank too", () => {
    expect(parseConfig({ ...VALID, TELEGRAM_BOT_TOKEN: "   " }).features.telegram).toBe(false);
  });

  it("still refuses a required variable that is blank", () => {
    expect(() => parseConfig({ ...VALID, DATABASE_URL: "" })).toThrow();
  });
});
