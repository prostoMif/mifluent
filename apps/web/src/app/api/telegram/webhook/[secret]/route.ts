/**
 * Where Telegram delivers updates for the bot.
 *
 * Two checks, both required: the secret in the path, and the same secret in
 * the header Telegram adds when the webhook was registered with it (see
 * `npm run telegram:webhook`). The path alone would end up in some proxy's
 * access log sooner or later.
 *
 * // TODO: security review — webhook authentication
 */

import { AppError, getConfig } from "@mifluent/core";
import { createTelegramApi, handleTelegramUpdate } from "@mifluent/delivery";
import { readJsonBody, route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isSameSecret } from "@/lib/secrets";

interface RouteContext {
  readonly params: Promise<{ readonly secret: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return route({ event: "telegram.update_received" }, async () => {
    const config = getConfig();
    const { secret } = await context.params;
    const header = request.headers.get("x-telegram-bot-api-secret-token");

    if (
      config.TELEGRAM_BOT_TOKEN === undefined ||
      !isSameSecret(secret, config.TELEGRAM_WEBHOOK_SECRET) ||
      !isSameSecret(header, config.TELEGRAM_WEBHOOK_SECRET)
    ) {
      // "Not found" rather than "forbidden": nothing here should confirm that
      // this path is a webhook at all.
      throw new AppError("not_found", "Not found.");
    }

    await handleTelegramUpdate({
      db: getDatabase(),
      api: createTelegramApi({ token: config.TELEGRAM_BOT_TOKEN }),
      logger,
      update: await readJsonBody(request),
    });
    return { received: true };
  });
}
