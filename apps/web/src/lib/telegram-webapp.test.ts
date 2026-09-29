/**
 * Tests for Telegram Web App initData verification.
 */

import { createHmac } from "node:crypto";
import { AppError } from "@mifluent/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config before importing the module
vi.mock("@mifluent/core", async () => {
  const actual = await vi.importActual("@mifluent/core");
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      TELEGRAM_BOT_TOKEN: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ",
    })),
  };
});

import { parseInitData, verifyInitData } from "./telegram-webapp.js";

function generateValidInitData(
  overrides: Partial<{
    user: Record<string, unknown>;
    auth_date: number;
    query_id: string;
    start_param: string;
  }> = {},
): string {
  const botToken = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ";
  const auth_date = overrides.auth_date ?? Math.floor(Date.now() / 1000);

  const user = overrides.user ?? {
    id: 987654321,
    first_name: "Test",
    last_name: "User",
    username: "testuser",
    language_code: "en",
  };

  const params = new URLSearchParams();
  params.set("auth_date", String(auth_date));
  params.set("user", JSON.stringify(user));

  if (overrides.query_id) params.set("query_id", overrides.query_id);
  if (overrides.start_param) params.set("start_param", overrides.start_param);

  // Build data-check-string (without hash)
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map((key) => `${key}=${params.get(key)}`).join("\n");

  // Derive secret key: HMAC-SHA256("WebAppData", bot_token)
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();

  // Compute hash: HMAC-SHA256(data_check_string, secret_key)
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  params.set("hash", hash);

  return params.toString();
}

describe("parseInitData", () => {
  it("parses valid initData with user", () => {
    const initData = generateValidInitData();
    const parsed = parseInitData(initData);

    expect(parsed.auth_date).toBeDefined();
    expect(parsed.hash).toBeDefined();
    expect(parsed.user).toEqual({
      id: 987654321,
      first_name: "Test",
      last_name: "User",
      username: "testuser",
      language_code: "en",
    });
  });

  it("parses initData with start_param", () => {
    const initData = generateValidInitData({ start_param: "ref123" });
    const parsed = parseInitData(initData);

    expect(parsed.start_param).toBe("ref123");
  });

  it("throws on missing hash", () => {
    const params = new URLSearchParams();
    params.set("auth_date", String(Math.floor(Date.now() / 1000)));
    params.set("user", JSON.stringify({ id: 1, first_name: "Test" }));

    expect(() => parseInitData(params.toString())).toThrow(AppError);
    expect(() => parseInitData(params.toString())).toThrow("Missing hash");
  });

  it("throws on missing auth_date", () => {
    const params = new URLSearchParams();
    params.set("hash", "abc123");
    params.set("user", JSON.stringify({ id: 1, first_name: "Test" }));

    expect(() => parseInitData(params.toString())).toThrow(AppError);
    expect(() => parseInitData(params.toString())).toThrow("Missing auth_date");
  });

  it("throws on invalid user JSON", () => {
    const params = new URLSearchParams();
    params.set("auth_date", String(Math.floor(Date.now() / 1000)));
    params.set("hash", "abc123");
    params.set("user", "not valid json");

    expect(() => parseInitData(params.toString())).toThrow(AppError);
    expect(() => parseInitData(params.toString())).toThrow("Invalid user JSON");
  });
});

describe("verifyInitData", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts valid initData", async () => {
    const initData = generateValidInitData();
    const parsed = await verifyInitData(initData);

    expect(parsed.user?.id).toBe(987654321);
    expect(parsed.auth_date).toBe(Math.floor(Date.now() / 1000));
  });

  it("rejects initData with invalid signature", async () => {
    const initData = generateValidInitData();
    // Corrupt the hash
    const corrupted = initData.replace(/hash=[^&]+/, "hash=deadbeefdeadbeefdeadbeefdeadbeef");

    await expect(verifyInitData(corrupted)).rejects.toThrow(AppError);
    await expect(verifyInitData(corrupted)).rejects.toMatchObject({
      code: "unauthorized",
      details: { code: "invalid_signature" },
    });
  });

  it("rejects expired initData (older than 1 hour)", async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 60 * 60 - 1;
    const initData = generateValidInitData({ auth_date: oneHourAgo });

    await expect(verifyInitData(initData)).rejects.toThrow(AppError);
    await expect(verifyInitData(initData)).rejects.toMatchObject({
      code: "unauthorized",
      details: { code: "expired" },
    });
  });

  it("accepts initData at exactly 1 hour old", async () => {
    const exactlyOneHourAgo = Math.floor(Date.now() / 1000) - 60 * 60;
    const initData = generateValidInitData({ auth_date: exactlyOneHourAgo });

    const parsed = await verifyInitData(initData);
    expect(parsed.auth_date).toBe(exactlyOneHourAgo);
  });

  it("rejects initData from different bot token", async () => {
    // Generate initData with a different bot token
    const differentBotToken = "987654321:ZYXwvuTsrqPoNmLkJiHgFeDcBa";
    const auth_date = Math.floor(Date.now() / 1000);
    const user = { id: 987654321, first_name: "Test", username: "testuser" };

    const params = new URLSearchParams();
    params.set("auth_date", String(auth_date));
    params.set("user", JSON.stringify(user));

    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys.map((key) => `${key}=${params.get(key)}`).join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(differentBotToken).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    params.set("hash", hash);

    const initData = params.toString();

    await expect(verifyInitData(initData)).rejects.toThrow(AppError);
    await expect(verifyInitData(initData)).rejects.toMatchObject({
      code: "unauthorized",
      details: { code: "invalid_signature" },
    });
  });
});
