import { createLogger } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TELEGRAM_ACTIONS = ["not_following_target", "not_important", "saved", "influenced"];

vi.mock("@mifluent/domain", () => ({
  findCardOwner: vi.fn(),
  recordCardAction: vi.fn(),
  recordDecision: vi.fn(),
  INFLUENCED_ACTION: "influenced",
  isTelegramCardAction: (value: string) => TELEGRAM_ACTIONS.includes(value),
}));
vi.mock("./bind.js", () => ({ consumeBindingCode: vi.fn() }));
vi.mock("./pending-decision.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pending-decision.js")>()),
  listChatProfiles: vi.fn(),
  setPendingDecision: vi.fn(),
  clearPendingDecision: vi.fn(),
}));

import { findCardOwner, recordCardAction, recordDecision } from "@mifluent/domain";
import { consumeBindingCode } from "./bind.js";
import {
  clearPendingDecision,
  DECISION_REPLY_WINDOW_MS,
  listChatProfiles,
  setPendingDecision,
} from "./pending-decision.js";
import type { TelegramApi } from "./telegram-api.js";
import { handleTelegramUpdate } from "./updates.js";

const db = {} as Queryable;
const logger = createLogger({ level: "error" });
const NOW = new Date("2026-09-24T09:00:00.000Z");

function fakeApi(): TelegramApi & { sent: string[]; answered: string[]; forced: boolean[] } {
  const sent: string[] = [];
  const answered: string[] = [];
  const forced: boolean[] = [];
  let nextMessageId = 500;
  return {
    sent,
    answered,
    forced,
    sendMessage: async (_chatId, message) => {
      sent.push(message.text);
      forced.push(message.forceReply === true);
      nextMessageId += 1;
      return { messageId: nextMessageId };
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

function reply(chatId: number, text: string, replyToMessageId: number | undefined): unknown {
  return {
    update_id: 7,
    message: {
      chat: { id: chatId },
      text,
      ...(replyToMessageId === undefined
        ? {}
        : { reply_to_message: { message_id: replyToMessageId } }),
    },
  };
}

describe("handleTelegramUpdate", () => {
  beforeEach(() => {
    vi.mocked(findCardOwner).mockReset();
    vi.mocked(recordCardAction).mockReset();
    vi.mocked(recordDecision).mockReset();
    vi.mocked(consumeBindingCode).mockReset();
    vi.mocked(listChatProfiles).mockReset();
    vi.mocked(listChatProfiles).mockResolvedValue([]);
    vi.mocked(setPendingDecision).mockReset();
    vi.mocked(clearPendingDecision).mockReset();
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

  it("asks what the reader decided after the influenced button", async () => {
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
      now: NOW,
      update: press(42, "influenced:card-1"),
    });

    expect(api.sent[0]).toContain("What did you decide?");
    expect(api.forced[0]).toBe(true);
    expect(setPendingDecision).toHaveBeenCalledWith(db, "t1", "p1", {
      cardId: "card-1",
      messageId: 501,
      askedAt: NOW,
    });
  });

  it("writes a decision when the answer replies to the question", async () => {
    vi.mocked(listChatProfiles).mockResolvedValue([
      {
        tenantId: "t1",
        profileId: "p1",
        pending: { cardId: "card-1", messageId: 501, askedAt: NOW },
      },
    ]);
    vi.mocked(recordDecision).mockResolvedValue({ id: "d1", targetName: "Stripe" });
    const api = fakeApi();

    await handleTelegramUpdate({
      db,
      api,
      logger,
      now: NOW,
      update: reply(42, "Holding our price, adding a cheaper tier", 501),
    });

    expect(recordDecision).toHaveBeenCalledWith(db, {
      tenantId: "t1",
      cardId: "card-1",
      text: "Holding our price, adding a cheaper tier",
    });
    expect(api.sent[0]).toContain("Stripe");
  });

  it("does not write a decision when the answer is not a reply", async () => {
    vi.mocked(listChatProfiles).mockResolvedValue([
      {
        tenantId: "t1",
        profileId: "p1",
        pending: { cardId: "card-1", messageId: 501, askedAt: NOW },
      },
    ]);
    const api = fakeApi();

    await handleTelegramUpdate({
      db,
      api,
      logger,
      now: NOW,
      update: reply(42, "we are keeping the price", undefined),
    });

    expect(recordDecision).not.toHaveBeenCalled();
    expect(api.sent[0]).toContain("again");
  });

  it("does not write a decision when the answer arrives after a day", async () => {
    vi.mocked(listChatProfiles).mockResolvedValue([
      {
        tenantId: "t1",
        profileId: "p1",
        pending: { cardId: "card-1", messageId: 501, askedAt: NOW },
      },
    ]);
    const api = fakeApi();
    const late = new Date(NOW.getTime() + DECISION_REPLY_WINDOW_MS + 1_000);

    await handleTelegramUpdate({
      db,
      api,
      logger,
      now: late,
      update: reply(42, "we are keeping the price", 501),
    });

    expect(recordDecision).not.toHaveBeenCalled();
    expect(clearPendingDecision).toHaveBeenCalledWith(db, "t1", "p1");
    expect(api.sent[0]).toContain("again");
  });

  it("does not write a decision when the reply belongs to another chat's question", async () => {
    vi.mocked(listChatProfiles).mockResolvedValue([
      {
        tenantId: "t1",
        profileId: "p1",
        pending: { cardId: "card-1", messageId: 501, askedAt: NOW },
      },
    ]);
    const api = fakeApi();

    await handleTelegramUpdate({
      db,
      api,
      logger,
      now: NOW,
      update: reply(42, "we are keeping the price", 999),
    });

    expect(recordDecision).not.toHaveBeenCalled();
  });

  it("keeps the decision text out of the log", async () => {
    vi.mocked(listChatProfiles).mockResolvedValue([
      {
        tenantId: "t1",
        profileId: "p1",
        pending: { cardId: "card-1", messageId: 501, askedAt: NOW },
      },
    ]);
    vi.mocked(recordDecision).mockResolvedValue({ id: "d1", targetName: "Stripe" });
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    await handleTelegramUpdate({
      db,
      api: fakeApi(),
      logger: createLogger({ level: "debug" }),
      now: NOW,
      update: reply(42, "we are dropping the Team plan", 501),
    });

    spy.mockRestore();
    errorSpy.mockRestore();
    expect(lines.join("\n")).not.toContain("dropping the Team plan");
  });
});
