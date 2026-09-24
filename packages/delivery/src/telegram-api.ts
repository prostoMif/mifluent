/**
 * The Telegram Bot API, the four calls this product needs.
 *
 * Plain `fetch` rather than an SDK: the surface is four methods and a stable
 * JSON protocol, and every dependency in a public repository is one more thing
 * to audit. The host is fixed — nothing user-supplied is ever fetched here.
 *
 * The bot token is part of the request path, which is how Telegram wants it.
 * It therefore never appears in an error: a failure reports the method name
 * and Telegram's own description, and the URL stays inside this file.
 */

import { AppError } from "@mifluent/core";
import { z } from "zod";

export interface InlineButton {
  readonly text: string;
  /** At most 64 bytes, per the Bot API. */
  readonly callbackData: string;
}

export interface OutgoingMessage {
  readonly text: string;
  /** One row of buttons under the message, or none. */
  readonly buttons?: readonly InlineButton[] | undefined;
}

export interface TelegramApi {
  sendMessage(chatId: string, message: OutgoingMessage): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
  getUpdates(offset: number | undefined, timeoutSeconds: number): Promise<unknown[]>;
  setWebhook(url: string, secretToken: string): Promise<void>;
}

export interface TelegramApiOptions {
  readonly token: string;
  readonly fetch?: typeof fetch;
}

const API_HOST = "https://api.telegram.org";

/** Telegram's own limit is 4096; the margin covers entity expansion. */
export const MAX_MESSAGE_LENGTH = 4_000;

/** Long polling holds the request open; the client waits a little longer than Telegram does. */
const REQUEST_TIMEOUT_MARGIN_MS = 10_000;

const responseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  error_code: z.number().optional(),
});

export function createTelegramApi(options: TelegramApiOptions): TelegramApi {
  const call = async (method: string, body: object, timeoutMs = 20_000): Promise<unknown> => {
    const response = await post(options, method, body, timeoutMs);
    return readResult(response, method);
  };

  return {
    async sendMessage(chatId, message) {
      await call("sendMessage", {
        chat_id: chatId,
        text: message.text,
        parse_mode: "HTML",
        // A digest links to sources; a preview of the first one would make
        // every message look like an advertisement for it.
        link_preview_options: { is_disabled: true },
        ...(message.buttons === undefined || message.buttons.length === 0
          ? {}
          : {
              reply_markup: {
                inline_keyboard: [
                  message.buttons.map((button) => ({
                    text: button.text,
                    callback_data: button.callbackData,
                  })),
                ],
              },
            }),
      });
    },

    async answerCallbackQuery(callbackQueryId, text) {
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    },

    async getUpdates(offset, timeoutSeconds) {
      const result = await call(
        "getUpdates",
        {
          timeout: timeoutSeconds,
          allowed_updates: ["message", "callback_query"],
          ...(offset === undefined ? {} : { offset }),
        },
        timeoutSeconds * 1_000 + REQUEST_TIMEOUT_MARGIN_MS,
      );
      return Array.isArray(result) ? result : [];
    },

    async setWebhook(url, secretToken) {
      await call("setWebhook", {
        url,
        secret_token: secretToken,
        allowed_updates: ["message", "callback_query"],
      });
    },
  };
}

async function post(
  options: TelegramApiOptions,
  method: string,
  body: object,
  timeoutMs: number,
): Promise<Response> {
  const fetchFn = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchFn(`${API_HOST}/bot${options.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (thrown) {
    throw new AppError("delivery_failed", "Telegram could not be reached.", {
      method,
      reason: thrown instanceof Error ? thrown.name : "unknown",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResult(response: Response, method: string): Promise<unknown> {
  const parsed = responseSchema.safeParse(await response.json().catch(() => undefined));
  if (parsed.success && parsed.data.ok) return parsed.data.result;

  throw new AppError("delivery_failed", "Telegram refused the request.", {
    method,
    httpStatus: response.status,
    errorCode: parsed.success ? parsed.data.error_code : undefined,
    description: parsed.success ? parsed.data.description : undefined,
  });
}
