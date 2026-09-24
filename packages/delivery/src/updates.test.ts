import { createLogger } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mifluent/domain", () => ({
  findCardOwner: vi.fn(),
  recordCardAction: vi.fn(),
  isCardAction: (value: string) =>
    ["not_following_target", "not_important", "saved"].includes(value),
}));
vi.mock("./bind.js", () => ({ consumeBindingCode: vi.fn() }));

import { findCardOwner, recordCardAction } from "@mifluent/domain";
import { consumeBindingCode } from "./bind.js";
import type { TelegramApi } from "./telegram-api.js";
import { handleTelegramUpdate } from "./updates.js";

const db = {} as Queryable;
const logger = createLogger({ level: "error" });

function fakeApi(): TelegramApi & { sent: string[]; answered: string[] } {
  const sent: string[] = [];
  const answered: string[] = [];
  return {
    sent,
    answered,
    sendMessage: async (_chatId, message) => {
      sent.push(message.text);
    },
    answerCallbackQuery: async (_id, text) => {
      answered.push(text);
    },
    getUpdates: async () => [],
    setWebhook: async () => undefined,
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
