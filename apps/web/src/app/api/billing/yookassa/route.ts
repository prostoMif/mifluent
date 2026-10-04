/**
 * Where ЮKassa reports a payment.
 *
 * ЮKassa's notifications are not signed, so the body is trusted for one thing
 * only — which payment it is about. Its status, amount and our order id are
 * then read from the ЮKassa API with the shop's own key, which a forger does
 * not have. A notification that names no real payment of this shop fails that
 * lookup and changes nothing.
 *
 * Answers 200 once the payment has been read, whatever the outcome: ЮKassa
 * retries anything else for 24 hours, and a duplicate or an unknown order is
 * for the owner to see in the logs, not something a retry will fix. A failed
 * lookup answers an error on purpose, so ЮKassa delivers it again.
 *
 * // TODO: security review — payments, webhook authentication
 */

import { AppError, getConfig } from "@mifluent/core";
import { applyPaymentNotification } from "@mifluent/domain";
import { readJsonBody, route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { tellOwner } from "@/lib/owner-notify";
import {
  fetchPayment,
  outcomeOf,
  readNotificationPaymentId,
  yookassaCredentials,
} from "@/lib/yookassa";

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.notification_received" }, async () => {
    const credentials = yookassaCredentials(getConfig());
    if (credentials === undefined) throw new AppError("not_found", "Not found.");

    const paymentId = readNotificationPaymentId(await readJsonBody(request));
    if (paymentId === undefined) return { received: true };

    const payment = await fetchPayment(credentials, paymentId);
    const outcome = outcomeOf(payment);
    if (outcome === undefined) {
      logger.info("billing.notification_ignored", { paymentId, status: payment.status });
      return { received: true };
    }

    const result = await applyPaymentNotification(getDatabase(), {
      ...outcome,
      provider: "yookassa",
      payload: { paymentId: payment.id, status: payment.status, amount: payment.amount },
    });
    const level = result === "applied" || result === "duplicate" ? "info" : "warn";
    logger[level]("billing.notification_applied", { orderId: outcome.orderId, outcome: result });

    if (result === "applied") {
      // The receipt in «Мой налог» is ЮKassa's job; this is only so the owner
      // sees each payment as it lands.
      await tellOwner(
        `Оплата ${payment.amount.value} ${payment.amount.currency} (заказ ${outcome.orderId}).`,
      );
    }
    return { received: true };
  });
}
