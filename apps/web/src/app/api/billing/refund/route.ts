/**
 * Ask for a refund within the refund window. The money goes back by hand in
 * the provider's dashboard; the owner is told here and confirms with
 * `npm run billing:refund -- <orderId>`.
 *
 * // TODO: security review — payments
 */

import { getConfig } from "@mifluent/core";
import { createTelegramApi } from "@mifluent/delivery";
import { requestRefund } from "@mifluent/domain";
import { route } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { getDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requireSessionWith } from "@/lib/session";

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.refund_requested", status: 201 }, async () => {
    assertSameOrigin(request);
    const session = await requireSessionWith("instance:manage");
    const refund = await requestRefund(getDatabase(), session.tenantId);

    await tellOwner(
      `Запрос возврата: ${(refund.amountMinor / 100).toFixed(2)} ${refund.currency}, заказ ${refund.orderId}.\n` +
        `Верни деньги в кабинете Prodamus, затем: npm run billing:refund -- ${refund.orderId}`,
    );
    return { requested: true };
  });
}

async function tellOwner(text: string): Promise<void> {
  const { TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_CHAT_ID } = getConfig();
  if (TELEGRAM_BOT_TOKEN === undefined || OWNER_TELEGRAM_CHAT_ID === undefined) {
    logger.warn("billing.owner_not_notified", { reason: "no owner chat configured" });
    return;
  }
  try {
    await createTelegramApi({ token: TELEGRAM_BOT_TOKEN }).sendMessage(OWNER_TELEGRAM_CHAT_ID, {
      text,
      parseMode: undefined,
    });
  } catch (error) {
    // The request is recorded either way; a missed message means the owner
    // finds it in the daily report instead of right away.
    logger.warn("billing.owner_not_notified", { cause: error });
  }
}
