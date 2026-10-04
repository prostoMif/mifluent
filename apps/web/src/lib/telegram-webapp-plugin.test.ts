/**
 * The Mini App sign-in, end to end through a real Better Auth instance: the
 * cookie it sets must be one Better Auth itself accepts as a session. That is
 * the whole point of the plugin — a hand-written cookie passed its own tests
 * and would still have broken on a library upgrade.
 */

import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it, vi } from "vitest";

const BOT_TOKEN = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ";
const TELEGRAM_USER_ID = 987654321;
const BASE_URL = "https://mifluent.test";

vi.mock("@mifluent/core", async () => {
  const actual = await vi.importActual("@mifluent/core");
  return { ...actual, getConfig: vi.fn(() => ({ TELEGRAM_BOT_TOKEN: BOT_TOKEN })) };
});

import { telegramWebApp } from "./telegram-webapp-plugin.js";

function signedInitData(telegramUserId: number, botToken: string = BOT_TOKEN): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAH",
    user: JSON.stringify({ id: telegramUserId, first_name: "Test" }),
  };
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

async function createInstance() {
  let linkedUserId: string | undefined;
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "a-test-secret-that-is-long-enough-0123456789",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    plugins: [
      telegramWebApp({
        findUserIdByTelegram: async (id) => (id === TELEGRAM_USER_ID ? linkedUserId : undefined),
      }),
    ],
  });
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    email: "owner@mifluent.test",
    name: "Owner",
    emailVerified: false,
  });
  linkedUserId = user.id;
  return { auth, userId: user.id };
}

function signIn(auth: { handler: (request: Request) => Promise<Response> }, initData: string) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/telegram-webapp/sign-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      body: JSON.stringify({ initData }),
    }),
  );
}

describe("Mini App sign-in", () => {
  it("sets a cookie Better Auth accepts as the linked user's session", async () => {
    const { auth, userId } = await createInstance();

    const response = await signIn(auth, signedInitData(TELEGRAM_USER_ID));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirect: "/today" });

    const setCookie = response.headers.getSetCookie();
    const sessionCookie = setCookie.find((cookie) => cookie.includes("session_token="));
    expect(sessionCookie).toMatch(/SameSite=None/i);
    expect(sessionCookie).toMatch(/Secure/);
    expect(sessionCookie).toMatch(/HttpOnly/);

    const cookieHeader = setCookie.map((cookie) => cookie.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    expect(session?.user.id).toBe(userId);
  });

  it("refuses initData signed with another bot's token", async () => {
    const { auth } = await createInstance();
    const response = await signIn(auth, signedInitData(TELEGRAM_USER_ID, "999:another-bot"));
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("tells a Telegram user with no account to start with the bot", async () => {
    const { auth } = await createInstance();
    const response = await signIn(auth, signedInitData(TELEGRAM_USER_ID + 1));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "NO_ACCOUNT" });
  });
});
