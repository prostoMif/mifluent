/**
 * Point the bot's webhook at this instance and set the Mini App menu button.
 *
 * Usage: npm run telegram:webhook
 *
 * Registers APP_URL/api/telegram/webhook/<secret> with Telegram, and asks
 * Telegram to send the same secret in a header on every call — the route
 * checks both. Run once after deploying, and again if APP_URL changes.
 * Also sets the chat menu button to open the Mini App.
 */

import { getConfig } from "@mifluent/core";
import { createTelegramApi, type MenuButton } from "@mifluent/delivery";

async function main(): Promise<void> {
  const config = getConfig();
  const token = config.TELEGRAM_BOT_TOKEN;
  const secret = config.TELEGRAM_WEBHOOK_SECRET;

  if (token === undefined || secret === undefined) {
    process.stderr.write("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first.\n");
    process.exit(1);
  }

  const api = createTelegramApi({ token });

  const url = `${config.APP_URL.replace(/\/+$/, "")}/api/telegram/webhook/${secret}`;
  await api.setWebhook(url, secret);

  // Set the chat menu button to open the Mini App
  const miniAppUrl = `${config.APP_URL.replace(/\/+$/, "")}/tg`;
  const menuButton: MenuButton = {
    type: "web_app",
    text: "Open Mifluent",
    web_app: { url: miniAppUrl },
  };
  await api.setChatMenuButton(menuButton);

  // The address contains the secret; print only its public part.
  process.stdout.write(`Webhook set to ${config.APP_URL}/api/telegram/webhook/…\n`);
  process.stdout.write(`Menu button set to open ${miniAppUrl}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Could not set the webhook: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
