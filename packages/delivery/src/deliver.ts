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
  type MonthlyReportData as DigestMonthlyReportData,
  type DigestRef,
  type DigestView,
  loadDigestView,
  markDigestDelivered,
  markDigestFailed,
} from "@mifluent/digest";
import { and, eq, sql } from "drizzle-orm";
import {
  type EmailRenderOptions,
  renderEmailDigest,
  renderMonthlyReportEmail,
  sendDigestEmail,
} from "./email/index.js";
import { renderDigest, renderMonthlyReportTelegram } from "./render.js";
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

  const miniAppUrl = `${appUrl.replace(/\/+$/, "")}/tg`;
  const messages = renderDigest(digest, { appUrl, timezone, miniAppUrl });

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

/** Extract monthly report data from the digest's special card block. */
function extractMonthlyReportData(digest: DigestView): DigestMonthlyReportData | null {
  for (const card of digest.cards) {
    for (const block of card.blocks) {
      if (block.kind === "analyst_opinion") {
        try {
          const parsed = JSON.parse(block.content);
          if (parsed.type === "monthly_report") {
            return parseMonthlyReportData(parsed);
          }
        } catch {
          // Not a monthly report block
        }
      }
    }
  }
  return null;
}

function parseMonthlyReportData(data: {
  month: string;
  profileName: string;
  language: "en" | "ru";
  topEvents: Array<{
    id: string;
    targetName: string | null;
    kind: string | null;
    summary: string;
    sourceUrl: string | null;
    occurredAt: string;
    facts?: Array<{ statement: string; quote: string }>;
  }>;
  targetSummaries: Array<{
    targetId: string;
    targetName: string;
    targetKind: string;
    oneLiner: string;
    isQuiet: boolean;
  }>;
  priceChanges: Array<{
    targetId: string;
    targetName: string;
    kind: "price" | "plan";
    was: string | null;
    became: string;
    sourceUrl: string | null;
    occurredAt: string;
  }>;
  hiringSummaries: Array<{
    targetId: string;
    targetName: string;
    openCount: number;
    newThisMonth: number;
    departments: string[];
  }>;
  decisions: { count: number; decisionIds: string[] };
  driftedTargets: Array<{
    targetId: string;
    targetName: string;
    targetKind: string;
    daysSinceActivity: number;
    lastEventAt: string | null;
    lastReactionAt: string | null;
  }>;
  intro: Array<{ text: string; eventIds: string[] }> | null;
  sourcesChecked: number;
  itemsConsidered: number;
}): DigestMonthlyReportData {
  return {
    month: data.month,
    profileId: "", // Not stored in JSON, but not needed for delivery
    profileName: data.profileName,
    language: data.language,
    topEvents: data.topEvents.map((e) => ({
      id: e.id,
      targetId: null, // Not stored in JSON
      targetName: e.targetName,
      targetKind: null,
      kind: e.kind,
      summary: e.summary,
      facts: e.facts ?? [],
      occurredAt: new Date(e.occurredAt),
      sourceUrl: e.sourceUrl,
    })),
    targetSummaries: data.targetSummaries.map((t) => ({
      targetId: t.targetId,
      targetName: t.targetName,
      targetKind: t.targetKind,
      eventCount: 0, // Not stored in JSON
      topEventKinds: [], // Not stored in JSON
      oneLiner: t.oneLiner,
      isQuiet: t.isQuiet,
    })),
    priceChanges: data.priceChanges.map((p) => ({
      targetId: p.targetId,
      targetName: p.targetName,
      kind: p.kind,
      was: p.was,
      became: p.became,
      quote: null,
      sourceUrl: p.sourceUrl,
      occurredAt: new Date(p.occurredAt),
    })),
    hiringSummaries: data.hiringSummaries,
    decisions: { count: data.decisions.count, decisionIds: data.decisions.decisionIds },
    driftedTargets: data.driftedTargets.map((d) => ({
      targetId: d.targetId,
      targetName: d.targetName,
      targetKind: d.targetKind,
      lastEventAt: d.lastEventAt ? new Date(d.lastEventAt) : null,
      lastReactionAt: d.lastReactionAt ? new Date(d.lastReactionAt) : null,
      daysSinceActivity: d.daysSinceActivity,
    })),
    intro: data.intro ? { sentences: data.intro } : null,
    sourcesChecked: data.sourcesChecked,
    itemsConsidered: data.itemsConsidered,
    generatedAt: new Date(),
  };
}

/** Convert full MonthlyReportData to simplified version for Telegram rendering. */
function toTelegramReportData(report: DigestMonthlyReportData): {
  readonly month: string;
  readonly profileName: string;
  readonly language: "en" | "ru";
  readonly topEvents: readonly {
    readonly targetName: string | null;
    readonly kind: string | null;
    readonly summary: string;
  }[];
  readonly targetSummaries: readonly {
    readonly targetName: string;
    readonly oneLiner: string;
    readonly isQuiet: boolean;
  }[];
  readonly priceChangesCount: number;
  readonly hiringCount: number;
  readonly decisionsCount: number;
  readonly driftedCount: number;
  readonly intro: readonly { readonly text: string }[] | null;
  readonly sourcesChecked: number;
  readonly itemsConsidered: number;
} {
  return {
    month: report.month,
    profileName: report.profileName,
    language: report.language,
    topEvents: report.topEvents.map((e) => ({
      targetName: e.targetName,
      kind: e.kind,
      summary: e.summary,
    })),
    targetSummaries: report.targetSummaries.map((t) => ({
      targetName: t.targetName,
      oneLiner: t.oneLiner,
      isQuiet: t.isQuiet,
    })),
    priceChangesCount: report.priceChanges.length,
    hiringCount: report.hiringSummaries.length,
    decisionsCount: report.decisions.count,
    driftedCount: report.driftedTargets.length,
    intro: report.intro?.sentences.map((s) => ({ text: s.text })) ?? null,
    sourcesChecked: report.sourcesChecked,
    itemsConsidered: report.itemsConsidered,
  };
}

/** Deliver monthly report via Telegram (short version with button to full report). */
async function deliverMonthlyReportTelegram(
  options: DeliverOptions,
  digest: DigestView,
): Promise<DeliveryOutcome> {
  const { db, ref, logger, telegramApi, appUrl, timezone, now } = options;

  if (!telegramApi) {
    logger.warn("monthly_report.delivery_skipped", { ...ref, reason: "telegram_not_configured" });
    return { status: "failed", retryAfterMinutes: undefined };
  }

  if (digest.telegramChatId === null) {
    await markDigestFailed(db, ref, "telegram_not_bound");
    return { status: "not_bound", retryAfterMinutes: undefined };
  }

  const reportData = extractMonthlyReportData(digest);
  if (!reportData) {
    logger.warn("monthly_report.no_data", { ...ref });
    await markDigestFailed(db, ref, "monthly_report_no_data");
    return { status: "failed", retryAfterMinutes: undefined };
  }

  const miniAppUrl = `${appUrl.replace(/\/+$/, "")}/tg`;
  const reportUrl = `${appUrl.replace(/\/+$/, "")}/reports/${reportData.month}?profile=${digest.profileId}`;
  const isPro = true; // Monthly reports are only for Pro

  const telegramData = toTelegramReportData(reportData);
  const messages = renderMonthlyReportTelegram(telegramData, {
    appUrl,
    timezone,
    miniAppUrl,
    isPro,
    reportUrl,
  });

  try {
    for (const message of messages) {
      await telegramApi.sendMessage(digest.telegramChatId, message);
    }
  } catch (thrown) {
    const error = toAppError(thrown);
    logger.warn("monthly_report.delivery_failed", {
      ...ref,
      code: error.code,
      details: error.details,
    });

    if (isBotBlockedError(error)) {
      await markProfileTelegramBlocked(db, ref.tenantId, digest.profileId, now ?? new Date());
      await markDigestFailed(db, ref, "telegram_blocked");
      return { status: "failed", retryAfterMinutes: undefined };
    }

    const currentAttempt = getCurrentAttempt(digest.failureReason);
    if (isRetryableError(error) && currentAttempt < MAX_RETRIES) {
      const nextAttempt = currentAttempt + 1;
      const retryAfterMinutes = RETRY_DELAYS_MINUTES[nextAttempt - 1];
      await scheduleRetry(db, ref, nextAttempt, now ?? new Date());
      return { status: "failed", retryAfterMinutes };
    }

    await markDigestFailed(db, ref, error.code);
    return { status: "failed", retryAfterMinutes: undefined };
  }

  await markDigestDelivered(db, ref, now ?? new Date());
  logger.info("monthly_report.delivered", { ...ref, channel: "telegram" });
  return { status: "delivered", retryAfterMinutes: undefined };
}

/** Deliver monthly report via email (full version). */
async function deliverMonthlyReportEmail(
  options: DeliverOptions,
  digest: DigestView,
): Promise<DeliveryOutcome> {
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

  const reportData = extractMonthlyReportData(digest);
  if (!reportData) {
    logger.warn("monthly_report.no_data", { ...ref });
    await markDigestFailed(db, ref, "monthly_report_no_data");
    return { status: "failed", retryAfterMinutes: undefined };
  }

  const emailRenderOptions: EmailRenderOptions = {
    appUrl,
    timezone,
    actionBaseUrl: `${appUrl.replace(/\/+$/, "")}/a`,
    unsubscribeUrl: `${appUrl.replace(/\/+$/, "")}/unsubscribe/`,
    feedbackEmail,
  };

  // Convert report data to email format
  const emailData = {
    month: reportData.month,
    profileName: reportData.profileName,
    language: reportData.language,
    isPro: true,
    topEvents: reportData.topEvents.map((e) => ({
      targetName: e.targetName,
      kind: e.kind,
      summary: e.summary,
      sourceUrl: e.sourceUrl,
      occurredAt: e.occurredAt,
    })),
    targetSummaries: reportData.targetSummaries.map((t) => ({
      targetName: t.targetName,
      targetKind: t.targetKind,
      oneLiner: t.oneLiner,
      isQuiet: t.isQuiet,
    })),
    priceChanges: reportData.priceChanges.map((p) => ({
      targetName: p.targetName,
      kind: p.kind as "price" | "plan",
      was: p.was,
      became: p.became,
      sourceUrl: p.sourceUrl,
      occurredAt: p.occurredAt,
    })),
    hiringSummaries: reportData.hiringSummaries.map((h) => ({
      targetName: h.targetName,
      openCount: h.openCount,
      newThisMonth: h.newThisMonth,
      departments: h.departments,
    })),
    decisionsCount: reportData.decisions.count,
    driftedTargets: reportData.driftedTargets.map((d) => ({
      targetName: d.targetName,
      targetKind: d.targetKind,
      daysSinceActivity: d.daysSinceActivity,
    })),
    intro: reportData.intro?.sentences.map((s) => ({ text: s.text })) ?? null,
    sourcesChecked: reportData.sourcesChecked,
    itemsConsidered: reportData.itemsConsidered,
  };

  const rendered = renderMonthlyReportEmail(emailData, emailRenderOptions);

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
  logger.info("monthly_report.delivered", { ...ref, channel: "email" });
  return { status: "delivered", retryAfterMinutes: undefined };
}

export async function deliverDigest(options: DeliverOptions): Promise<DeliveryOutcome> {
  const { db, ref, logger } = options;
  const digest = await loadDigestView(db, ref.tenantId, ref.digestId);

  if (digest === undefined) return { status: "missing", retryAfterMinutes: undefined };

  // Check if this is a monthly report digest
  const isMonthlyReport = digest.cards.some((card) =>
    card.blocks.some((block) => {
      try {
        const parsed = JSON.parse(block.content);
        return parsed.type === "monthly_report";
      } catch {
        return false;
      }
    }),
  );

  if (isMonthlyReport) {
    switch (digest.channel) {
      case "telegram":
        return deliverMonthlyReportTelegram(options, digest);
      case "email":
        return deliverMonthlyReportEmail(options, digest);
      case "web_only":
        await markDigestDelivered(db, ref, options.now ?? new Date());
        logger.info("monthly_report.delivered", {
          ...ref,
          channel: "web_only",
        });
        return { status: "delivered", retryAfterMinutes: undefined };
      default:
        await markDigestFailed(db, ref, "unknown_channel");
        return { status: "failed", retryAfterMinutes: undefined };
    }
  }

  // Regular digest delivery
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
