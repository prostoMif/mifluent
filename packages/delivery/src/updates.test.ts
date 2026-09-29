import { type Config, getConfig } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { findCardOwner, recordCardAction } from "@mifluent/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeBindingCode } from "./bind.js";
import type { TelegramApi } from "./telegram-api.js";
import { cardIdTag, extractCardIdTag, handleTelegramUpdate } from "./updates.js";

vi.mock("@mifluent/core", () => ({
  getConfig: vi.fn(() => ({
    APP_URL: "https://test.example",
    TELEGRAM_BOT_USERNAME: "test_bot",
    features: { llm: true, telegram: true, email: true, googleSignIn: true, reddit: true },
  })),
}));
vi.mock("@mifluent/domain", () => ({
  findCardOwner: vi.fn(),
  recordCardAction: vi.fn(),
  isCardAction: (value: string) =>
    ["not_following_target", "not_important", "saved", "influenced"].includes(value),
}));
vi.mock("./bind.js", async () => {
  const actual = await vi.importActual("./bind.js");
  return {
    ...actual,
    consumeBindingCode: vi.fn(),
    deliverFirstDigestOnBind: vi.fn().mockResolvedValue(false),
  };
});

function createMockDb(): Queryable {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => Promise.resolve([])),
  };

  return {
    select: vi.fn(() => selectChain),
  } as unknown as Queryable;
}

const db = createMockDb();
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

vi.mocked(getConfig).mockReturnValue({
  APP_URL: "https://test.example",
  features: { llm: true, telegram: true, email: true, googleSignIn: true, reddit: true },
  planOverrides: {},
  isProduction: false,
  isDevelopment: true,
  DATABASE_URL: "postgresql://test",
  BETTER_AUTH_SECRET: "test",
  BETTER_AUTH_URL: "http://localhost",
  ENCRYPTION_KEY: "test",
  TELEGRAM_BOT_TOKEN: "test",
  TELEGRAM_BOT_USERNAME: "test_bot",
  REDIS_URL: "redis://localhost",
  S3_ENDPOINT: "http://localhost",
  S3_BUCKET: "test",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "test",
  S3_REGION: "test",
} as unknown as Config);

function fakeApi(): TelegramApi & { sent: string[]; answered: string[] } {
  const sent: string[] = [];
  const answered: string[] = [];
  return {
    sent,
    answered,
    sendMessage: async (_chatId: string, message: { text: string }) => {
      sent.push(message.text);
    },
    answerCallbackQuery: async (_id: string, text: string) => {
      answered.push(text);
    },
    getUpdates: async () => [],
    setWebhook: async () => undefined,
    setChatMenuButton: async () => undefined,
  };
}

function press(chatId: number, data: string): unknown {
  return { update_id: 1, callback_query: { id: "q1", data, message: { chat: { id: chatId } } } };
}

describe("handleTelegramUpdate", () => {
  beforeEach(() => {
    vi.mocked(findCardOwner).mockReset();
    vi.mocked(recordCardAction).mockReset();
    vi.mocked(consumeBindingCode).mockReset();
  });

  it("records a press from the chat the profile is bound to", async () => {
    vi.mocked(findCardOwner).mockResolvedValue({
      tenantId: "t1",
      eventId: "e1",
      profileId: "p1",
      telegramChatId: "42",
    });
    const api = fakeApi();

    await handleTelegramUpdate({ db, api, logger, update: press(42, "saved:card-1") });

    expect(recordCardAction).toHaveBeenCalledWith(db, {
      tenantId: "t1",
      cardId: "card-1",
      action: "saved",
      surface: "telegram",
    });
  });

  it("refuses a press about a card from another chat", async () => {
    vi.mocked(findCardOwner).mockResolvedValue({
      tenantId: "t1",
      eventId: "e1",
      profileId: "p1",
      telegramChatId: "42",
    });
    const api = fakeApi();

    await handleTelegramUpdate({
      db,
      api,
      logger,
      update: press(666, "not_following_target:card-1"),
    });

    expect(recordCardAction).not.toHaveBeenCalled();
    expect(api.answered).toEqual(["That card is no longer available"]);
  });

  it("refuses an action that does not exist", async () => {
    const api = fakeApi();

    await handleTelegramUpdate({ db, api, logger, update: press(42, "delete_everything:card-1") });

    expect(findCardOwner).not.toHaveBeenCalled();
    expect(recordCardAction).not.toHaveBeenCalled();
  });

  it("binds a chat with /start and a code", async () => {
    vi.mocked(consumeBindingCode).mockResolvedValue({
      tenantId: "t1",
      profileId: "p1",
      profileName: "Analytics SaaS",
      language: "en",
    });
    const api = fakeApi();

    await handleTelegramUpdate({
      db,
      api,
      logger,
      update: { update_id: 2, message: { chat: { id: 42 }, text: "/start ABCD2345" } },
    });

    expect(consumeBindingCode).toHaveBeenCalledWith(db, "ABCD2345", "42");
    expect(api.sent[0]).toContain("Analytics SaaS");
  });

  it("says the code is wrong rather than binding", async () => {
    vi.mocked(consumeBindingCode).mockResolvedValue(undefined);
    const api = fakeApi();

    await handleTelegramUpdate({
      db,
      api,
      logger,
      update: { update_id: 3, message: { chat: { id: 42 }, text: "/start WRONG999" } },
    });

    expect(api.sent[0]).toContain("not valid or has expired");
  });

  it("ignores an update in a shape it does not know", async () => {
    const api = fakeApi();

    await handleTelegramUpdate({ db, api, logger, update: { hello: "world" } });

    expect(api.sent).toEqual([]);
  });
});

describe("decision question tag", () => {
  // Two cards of one digest: UUIDv7 ids written in the same millisecond share
  // their leading timestamp and differ only in the random tail.
  const first = "0192ab3c-4d5e-7f00-8a1b-2c3d4e5f6a7b";
  const second = "0192ab3c-4d5e-7f00-9c8d-7e6f5a4b3c2d";

  it("tells apart cards created in the same moment", () => {
    expect(cardIdTag(first)).not.toBe(cardIdTag(second));
  });

  it("reads the tag back from the question text", () => {
    const question = `What did you decide?\n\n#${cardIdTag(first)}`;
    expect(extractCardIdTag(question)).toBe(cardIdTag(first));
    expect(first.endsWith(extractCardIdTag(question) ?? "missing")).toBe(true);
  });

  it("finds no tag in text without one", () => {
    expect(extractCardIdTag("What did you decide?")).toBeNull();
  });

  it("asks the question without markup Telegram would reject", async () => {
    vi.mocked(findCardOwner).mockResolvedValue({
      tenantId: "t1",
      eventId: "e1",
      profileId: "p1",
      telegramChatId: "42",
    });
    const api = fakeApi();

    await handleTelegramUpdate({ db, api, logger, update: press(42, `influenced:${first}`) });

    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]).not.toContain("<!--");
    expect(api.sent[0]).toContain(`#${cardIdTag(first)}`);
    expect(recordCardAction).not.toHaveBeenCalled();
  });
});
