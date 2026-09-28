/**
 * Sending one built digest to its Telegram chat.
 *
 * The failure reason stored on the digest is a short code, never Telegram's
 * text: an error from an API called with a token in its path is exactly the
 * kind of string that should not be written anywhere a person can read it.
 */

import { type AppError, type Logger, toAppError } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { schema, scoped } from "@mifluent/db";
import {
  type DigestRef,
  loadDigestView,
  markDigestDelivered,
  markDigestFailed,
} from "@mifluent/digest";
import { eq, sql } from "drizzle-orm";
import { renderDigest } from "./render.js";
import type { TelegramApi } from "./telegram-api.js";

export interface DeliverOptions {
  readonly db: Queryable;
  readonly api: TelegramApi;
  readonly logger: Logger;
  readonly ref: DigestRef;
  readonly appUrl: string;
  readonly timezone: string;
  readonly now?: Date | undefined;
}

export interface DeliveryOutcome {
  readonly status: "delivered" | "not_bound" | "failed" | "missing";
  /** Minutes until next retry attempt, if a retry is scheduled. */
  readonly retryAfterMinutes: number | undefined;
}

const RETRY_DELAYS_MINUTES = [5, 30, 120] as const;
const MAX_RETRIES = RETRY_DELAYS_MINUTES.length;

function isRetryableError(error: AppError): boolean {
  // Network errors, rate limits (429), server errors (5xx) are retryable
  if (error.code === "delivery_failed" && error.details) {
    const httpStatus = error.details["httpStatus"] as number | undefined;
    // Telegram returns 429 for rate limits, 400+ for client errors, 500+ for server errors
    if (httpStatus === 429) return true;
    if (httpStatus !== undefined && httpStatus >= 500) return true;
    // Network errors have no httpStatus
    if (httpStatus === undefined) return true;
  }
  return false;
}

function isBotBlockedError(error: AppError): boolean {
  if (error.code === "delivery_failed" && error.details) {
    const description = error.details["description"] as string | undefined;
    if (
      description?.includes("bot was blocked") ||
      description?.includes("Forbidden: bot was blocked")
    ) {
      return true;
    }
  }
  return false;
}

async function scheduleRetry(
  db: Queryable,
  ref: DigestRef,
  attempt: number,
  now: Date,
): Promise<void> {
  // Store retry attempt in failureReason
  await db
    .update(schema.digests)
    .set({
      failureReason: `delivery_failed:attempt:${attempt}`,
      updatedAt: now,
    })
    .where(scoped(schema.digests, ref.tenantId, eq(schema.digests.id, ref.digestId)));

  // Note: Actual scheduling is done by the caller (worker) using pg-boss
  // This function just updates the digest record
}

async function markProfileTelegramBlocked(
  db: Queryable,
  tenantId: string,
  profileId: string,
  now: Date,
): Promise<void> {
  await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`jsonb_set(${schema.watchProfiles.delivery}, '{telegramBlockedAt}', to_jsonb(${now}::timestamptz))`,
      updatedAt: now,
    })
    .where(scoped(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)));
}

export async function deliverDigest(options: DeliverOptions): Promise<DeliveryOutcome> {
  const { db, ref, logger } = options;
  const digest = await loadDigestView(db, ref.tenantId, ref.digestId);

  if (digest === undefined) return { status: "missing", retryAfterMinutes: undefined };

  if (digest.telegramChatId === null) {
    await markDigestFailed(db, ref, "telegram_not_bound");
    return { status: "not_bound", retryAfterMinutes: undefined };
  }

  const messages = renderDigest(digest, { appUrl: options.appUrl, timezone: options.timezone });

  try {
    for (const message of messages) {
      await options.api.sendMessage(digest.telegramChatId, message);
    }
  } catch (thrown) {
    const error = toAppError(thrown);
    logger.warn("digest.delivery_failed", { ...ref, code: error.code, details: error.details });

    // Check if bot was blocked
    if (isBotBlockedError(error)) {
      await markProfileTelegramBlocked(
        db,
        ref.tenantId,
        digest.profileId,
        options.now ?? new Date(),
      );
      await markDigestFailed(db, ref, "telegram_blocked");
      return { status: "failed", retryAfterMinutes: undefined };
    }

    // Check if retryable
    const currentAttempt = getCurrentAttempt(digest.failureReason);
    if (isRetryableError(error) && currentAttempt < MAX_RETRIES) {
      const nextAttempt = currentAttempt + 1;
      const retryAfterMinutes = RETRY_DELAYS_MINUTES[nextAttempt - 1];
      await scheduleRetry(db, ref, nextAttempt, options.now ?? new Date());
      // The worker will re-queue this digest for the next attempt
      return { status: "failed", retryAfterMinutes };
    }

    // Max retries exceeded or not retryable
    await markDigestFailed(db, ref, error.code);
    return { status: "failed", retryAfterMinutes: undefined };
  }

  await markDigestDelivered(db, ref, options.now ?? new Date());
  logger.info("digest.delivered", { ...ref, cardCount: digest.cards.length });
  return { status: "delivered", retryAfterMinutes: undefined };
}

function getCurrentAttempt(failureReason: string | null): number {
  if (!failureReason) return 0;
  const match = failureReason.match(/delivery_failed:attempt:(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}
