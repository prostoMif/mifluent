/**
 * Where Prodamus reports a payment.
 *
 * The signature is checked before anything is read; a bad one is "not found",
 * so the endpoint does not confirm it exists. Everything after that answers
 * 200: the provider retries until it gets one, and a duplicate or a payment we
 * cannot match is something for the owner to look at in the logs, not
 * something a retry will fix.
 *
 * // TODO: security review — payments, webhook authentication
 */

import { AppError, getConfig } from "@mifluent/core";
import { applyPaymentNotification } from "@mifluent/domain";
import { route } from "@/lib/api";
import { getDatabase } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isValidSignature, parseFormBody, readNotification } from "@/lib/prodamus";

/** A notification is a short form; anything bigger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  return route({ event: "billing.notification_received" }, async () => {
    const secret = getConfig().PRODAMUS_SECRET;
    const body = await request.text();
    if (secret === undefined || body.length > MAX_BODY_BYTES) {
      throw new AppError("not_found", "Not found.");
    }

    const tree = parseFormBody(body);
    if (!isValidSignature(tree, request.headers.get("sign"), secret)) {
      throw new AppError("not_found", "Not found.");
    }

    const notification = readNotification(tree);
    if (notification === undefined) {
      logger.warn("billing.notification_without_order", {});
      return { received: true };
    }

    const outcome = await applyPaymentNotification(getDatabase(), {
      ...notification,
      payload: tree,
    });
    const level = outcome === "applied" || outcome === "duplicate" ? "info" : "warn";
    logger[level]("billing.notification_applied", { orderId: notification.orderId, outcome });
    return { received: true };
  });
}
