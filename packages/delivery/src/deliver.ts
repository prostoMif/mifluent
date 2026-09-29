/**
 * Sending one built digest to its channel (Telegram or email).
 *
 * The failure reason stored on the digest is a short code, never an external
 * API's text: an error from an API called with a token in its path is exactly
 * the kind of string that should not be written anywhere a person can read it.
 */

import { type AppError, type Logger, toAppError } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { schema, scoped } from "@mifluent/db";
import {
  type DigestRef,
  type DigestView,
  loadDigestView,
  markDigestDelivered,
  markDigestFailed,
} from "@mifluent/digest";
import { and, eq, sql } from "drizzle-orm";
import { type EmailRenderOptions, renderEmailDigest, sendDigestEmail } from "./email/index.js";
import { renderDigest } from "./render.js";
import type { TelegramApi } from "./telegram-api.js";

export interface DeliverOptions {
  readonly db: Queryable;
  readonly logger: Logger;
  readonly ref: DigestRef;
  readonly appUrl: string;
  readonly timezone: string;
  readonly telegramApi?: TelegramApi | undefined;
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
    // SMTP errors typically have no httpStatus
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

async function markProfileEmailPaused(
  db: Queryable,
  tenantId: string,
  profileId: string,
  now: Date,
): Promise<void> {
  await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`jsonb_set(${schema.watchProfiles.delivery}, '{emailPausedAt}', to_jsonb(${now}::timestamptz))`,
      updatedAt: now,
    })
    .where(scoped(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)));
}

function getCurrentAttempt(failureReason: string | null): number {
  if (!failureReason) return 0;
  const match = failureReason.match(/delivery_failed:attempt:(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : 0;
}

async function handleDeliveryError(
  db: Queryable,
  ref: DigestRef,
  error: AppError,
  digest: DigestView,
  now: Date,
  logger: Logger,
): Promise<DeliveryOutcome> {
  logger.warn("digest.delivery_failed", { ...ref, code: error.code, details: error.details });

  // Check if retryable
  const currentAttempt = getCurrentAttempt(digest.failureReason);
  if (isRetryableError(error) && currentAttempt < MAX_RETRIES) {
    const nextAttempt = currentAttempt + 1;
    const retryAfterMinutes = RETRY_DELAYS_MINUTES[nextAttempt - 1];
    await scheduleRetry(db, ref, nextAttempt, now);
    return { status: "failed", retryAfterMinutes };
  }

  // Check for permanent failures (bounce, etc.)
  if (error.code === "delivery_failed" && error.details) {
    const smtpCode = error.details["smtpCode"] as number | undefined;
    if (smtpCode !== undefined && smtpCode >= 500 && smtpCode < 600) {
      // Permanent failure - pause email for this profile
      await markProfileEmailPaused(db, ref.tenantId, digest.profileId, now);
      await markDigestFailed(db, ref, "email_bounced");
      return { status: "failed", retryAfterMinutes: undefined };
    }
  }

  await markDigestFailed(db, ref, error.code);
  return { status: "failed", retryAfterMinutes: undefined };
}

async function deliverTelegram(
  options: DeliverOptions,
  digest: DigestView,
): Promise<DeliveryOutcome> {
  const { db, ref, logger, telegramApi, appUrl, timezone, now } = options;

  if (!telegramApi) {
    logger.warn("digest.delivery_skipped", { ...ref, reason: "telegram_not_configured" });
    return { status: "failed", retryAfterMinutes: undefined };
  }

  if (digest.telegramChatId === null) {
    await markDigestFailed(db, ref, "telegram_not_bound");
    return { status: "not_bound", retryAfterMinutes: undefined };
  }

  const messages = renderDigest(digest, { appUrl, timezone });

  try {
    for (const message of messages) {
      await telegramApi.sendMessage(digest.telegramChatId, message);
    }
  } catch (thrown) {
    const error = toAppError(thrown);
    logger.warn("digest.delivery_failed", { ...ref, code: error.code, details: error.details });

    // Check if bot was blocked
    if (isBotBlockedError(error)) {
      await markProfileTelegramBlocked(db, ref.tenantId, digest.profileId, now ?? new Date());
      await markDigestFailed(db, ref, "telegram_blocked");
      return { status: "failed", retryAfterMinutes: undefined };
    }

    // Check if retryable
    const currentAttempt = getCurrentAttempt(digest.failureReason);
    if (isRetryableError(error) && currentAttempt < MAX_RETRIES) {
      const nextAttempt = currentAttempt + 1;
      const retryAfterMinutes = RETRY_DELAYS_MINUTES[nextAttempt - 1];
      await scheduleRetry(db, ref, nextAttempt, now ?? new Date());
      return { status: "failed", retryAfterMinutes };
    }

    // Max retries exceeded or not retryable
    await markDigestFailed(db, ref, error.code);
    return { status: "failed", retryAfterMinutes: undefined };
  }

  await markDigestDelivered(db, ref, now ?? new Date());
  logger.info("digest.delivered", { ...ref, cardCount: digest.cards.length, channel: "telegram" });
  return { status: "delivered", retryAfterMinutes: undefined };
}

async function deliverEmail(options: DeliverOptions, digest: DigestView): Promise<DeliveryOutcome> {
  const { db, ref, logger, appUrl, timezone, now } = options;
  const currentTime = now ?? new Date();

  // Get the tenant owner's email
  const [owner] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.user.id))
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.tenantId, schema.memberships.tenantId))
    .where(
      and(
        eq(schema.watchProfiles.id, digest.profileId),
        eq(schema.memberships.role, "owner"),
        eq(schema.memberships.tenantId, ref.tenantId),
      ),
    )
    .limit(1);

  if (!owner?.email) {
    await markDigestFailed(db, ref, "email_not_found");
    return { status: "failed", retryAfterMinutes: undefined };
  }
  const ownerEmail = owner.email;

  const config = await import("@mifluent/core").then((m) => m.getConfig());
  const feedbackEmail = config.FEEDBACK_EMAIL ?? config.SMTP_FROM;
  if (!feedbackEmail) {
    await markDigestFailed(db, ref, "email_not_configured");
    return { status: "failed", retryAfterMinutes: undefined };
  }

  const emailRenderOptions: EmailRenderOptions = {
    appUrl,
    timezone,
    actionBaseUrl: `${appUrl.replace(/\/+$/, "")}/a`,
    unsubscribeUrl: `${appUrl.replace(/\/+$/, "")}/unsubscribe/`, // token will be appended
    feedbackEmail,
  };

  const rendered = renderEmailDigest(digest, emailRenderOptions);

  try {
    await sendDigestEmail({
      to: ownerEmail,
      rendered,
      feedbackEmail,
    });
  } catch (thrown) {
    const error = toAppError(thrown);
    return handleDeliveryError(db, ref, error, digest, currentTime, logger);
  }

  await markDigestDelivered(db, ref, currentTime);
  logger.info("digest.delivered", { ...ref, cardCount: digest.cards.length, channel: "email" });
  return { status: "delivered", retryAfterMinutes: undefined };
}

export async function deliverDigest(options: DeliverOptions): Promise<DeliveryOutcome> {
  const { db, ref, logger } = options;
  const digest = await loadDigestView(db, ref.tenantId, ref.digestId);

  if (digest === undefined) return { status: "missing", retryAfterMinutes: undefined };

  switch (digest.channel) {
    case "telegram":
      return deliverTelegram(options, digest);
    case "email":
      return deliverEmail(options, digest);
    case "web_only":
      await markDigestDelivered(db, ref, options.now ?? new Date());
      logger.info("digest.delivered", {
        ...ref,
        cardCount: digest.cards.length,
        channel: "web_only",
      });
      return { status: "delivered", retryAfterMinutes: undefined };
    default:
      await markDigestFailed(db, ref, "unknown_channel");
      return { status: "failed", retryAfterMinutes: undefined };
  }
}
