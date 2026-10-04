/**
 * `npm run billing:refund -- <orderId>` — the owner confirms a refund went
 * back in the ЮKassa dashboard (or by transfer for a manual payment). The
 * order becomes refunded and the tenant falls back to its other paid time, or to Free; nothing is deleted.
 */

import { isUuid } from "@mifluent/core";
import { confirmRefund } from "@mifluent/domain";
import { getDatabase, logger } from "./runtime.js";

const orderId = process.argv[2];

if (orderId === undefined || !isUuid(orderId)) {
  process.stderr.write("Usage: npm run billing:refund -- <orderId>\n");
  process.exit(1);
}

try {
  await confirmRefund(getDatabase(), orderId);
  process.stdout.write(`Order ${orderId} marked refunded.\n`);
  logger.info("billing.refund_confirmed", { orderId });
  process.exit(0);
} catch (error) {
  logger.error("billing.refund_confirm_failed", { orderId, cause: error });
  process.stderr.write("No refund request for that order.\n");
  process.exit(1);
}
