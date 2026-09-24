/**
 * Receiving Telegram updates by asking for them — local development only.
 *
 * In production Telegram calls the web application's webhook. A laptop has no
 * public address for that, so with TELEGRAM_POLLING=true the worker long-polls
 * instead and hands each update to the same handler the webhook uses.
 */

import { toAppError } from "@mifluent/core";
import { handleTelegramUpdate, type TelegramApi } from "@mifluent/delivery";
import { z } from "zod";
import { getDatabase, logger } from "./runtime.js";

/** Telegram holds the request open this long when there is nothing to send. */
const LONG_POLL_SECONDS = 25;

/** After a failure, wait before asking again rather than hammering the API. */
const RETRY_DELAY_MS = 5_000;

const updateIdSchema = z.object({ update_id: z.number() });

export function startTelegramPolling(api: TelegramApi): () => void {
  let isRunning = true;
  let offset: number | undefined;

  const loop = async (): Promise<void> => {
    while (isRunning) {
      try {
        const updates = await api.getUpdates(offset, LONG_POLL_SECONDS);
        for (const update of updates) {
          const parsed = updateIdSchema.safeParse(update);
          if (parsed.success) offset = parsed.data.update_id + 1;
          await handleTelegramUpdate({ db: getDatabase(), api, logger, update });
        }
      } catch (thrown) {
        logger.warn("telegram.polling_failed", { code: toAppError(thrown).code });
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  };

  void loop(); // Runs for the life of the process; stopped by the flag below.
  logger.info("telegram.polling_started", {});

  return () => {
    isRunning = false;
  };
}
