/**
 * Web onboarding: anonymous discovery → pending onboarding → magic link → account.
 *
 * This module handles the server-side logic for the new onboarding v2 flow:
 * 1. Anonymous user submits a website/business description at /start
 * 2. We run discovery (with IP limits, domain cache, daily cost cap)
 * 3. Store result in pending_onboardings with a cookie
 * 4. User reviews and edits the discovery result
 * 5. User chooses channel (email/Telegram) and provides email
 * 6. Magic link sent → click creates account + tenant + profile in one transaction
 */

import { createHash, randomBytes } from "node:crypto";
import { AppError, getConfig, uuidv7 } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { schema } from "@mifluent/db";
import type { DiscoveryResult, OnboardingChannel, PendingOnboarding } from "@mifluent/db/schema";
import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { QUEUES } from "../jobs/queues.js";
import { assertCanRunDiscovery } from "../plans/limits.js";
import { ANON_TENANT_ID } from "./anon-tenant.js";

const PENDING_COOKIE_NAME = "mifluent.pending";
const PENDING_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours
const IP_HASH_SALT = "mifluent-ip-salt-v1"; // Rotate to invalidate all hashes
const EXPIRY_HOURS = 24;
const ANON_DISCOVERY_PER_DAY_DEFAULT = 30;
const IP_DISCOVERY_PER_DAY = 3;
const DOMAIN_CACHE_DAYS = 7;

/** Hash an IP address with a salt for privacy-preserving rate limiting. */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(IP_HASH_SALT + ip)
    .digest("hex");
}

/** Hash an email for deduplication. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** Generate a secure random token for the pending cookie. */
export function generatePendingToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Read the pending onboarding cookie from the request. */
export function readPendingToken(cookies: Map<string, string>): string | undefined {
  return cookies.get(PENDING_COOKIE_NAME);
}

/** Options for setting the pending cookie. */
export interface SetPendingCookieOptions {
  readonly token: string;
  readonly isProduction: boolean;
}

/** Serialize the pending cookie for response headers. */
export function serializePendingCookie({ token, isProduction }: SetPendingCookieOptions): string {
  const parts = [
    `${PENDING_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${PENDING_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

/** Clear the pending cookie. */
export function clearPendingCookie(isProduction: boolean): string {
  const parts = [`${PENDING_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

/** Check if anonymous discovery is allowed for this IP. */
export async function assertAnonDiscoveryAllowed(db: Queryable, ipHash: string): Promise<void> {
  const config = getConfig();
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // Check IP limit (3 per day)
  const [ipCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.pendingOnboardings)
    .where(
      and(
        eq(schema.pendingOnboardings.ipHash, ipHash),
        gte(schema.pendingOnboardings.createdAt, dayStart),
      ),
    );

  if ((ipCount?.count ?? 0) >= IP_DISCOVERY_PER_DAY) {
    throw new AppError(
      "rate_limited",
      `You have reached the limit of ${IP_DISCOVERY_PER_DAY} site readings per day. Try again tomorrow.`,
    );
  }

  // Check global anonymous discovery limit
  const anonLimit = config.ANON_DISCOVERY_PER_DAY ?? ANON_DISCOVERY_PER_DAY_DEFAULT;
  const [globalCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.pendingOnboardings)
    .where(gte(schema.pendingOnboardings.createdAt, dayStart));

  if ((globalCount?.count ?? 0) >= anonLimit) {
    throw new AppError(
      "rate_limited",
      `The daily limit for anonymous site readings has been reached. Try again tomorrow.`,
    );
  }

  // Check daily cost cap
  await assertCanRunDiscovery(db, "anon");
}

/** Find a cached discovery result for a domain (7 days). */
export async function findCachedDiscovery(
  db: Queryable,
  domain: string,
): Promise<DiscoveryResult | undefined> {
  const cutoff = new Date(Date.now() - DOMAIN_CACHE_DAYS * 24 * 60 * 60 * 1000);

  // Extract domain from input if it's a URL
  const normalizedDomain = extractDomain(domain);
  if (!normalizedDomain) return undefined;

  const [row] = await db
    .select({ result: schema.pendingOnboardings.result })
    .from(schema.pendingOnboardings)
    .where(
      and(
        // The input contains the domain
        sql`${schema.pendingOnboardings.input} ILIKE ${`%${normalizedDomain}%`}`,
        // Has a completed result
        isNull(schema.pendingOnboardings.consumedAt),
        // Not expired
        gte(schema.pendingOnboardings.expiresAt, new Date()),
        // Recent enough for cache
        gte(schema.pendingOnboardings.createdAt, cutoff),
        // Has a result
        sql`${schema.pendingOnboardings.result} IS NOT NULL`,
      ),
    )
    .orderBy(schema.pendingOnboardings.createdAt)
    .limit(1);

  if (row?.result) {
    return row.result as DiscoveryResult;
  }
  return undefined;
}

/** Extract domain from URL or return the input if it's not a URL. */
function extractDomain(input: string): string | null {
  try {
    const url = new URL(input);
    return url.hostname.replace(/^www\./, "");
  } catch {
    // Not a URL, might be a business description
    return null;
  }
}

/** Create a pending onboarding record for anonymous discovery. */
export async function createPendingOnboarding(
  db: Queryable,
  options: {
    readonly input: string;
    readonly language: "en" | "ru";
    readonly timezone: string | undefined;
    readonly ipHash: string;
    readonly discoveryRunId: string;
  },
): Promise<PendingOnboarding> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_HOURS * 60 * 60 * 1000);

  const [row] = await db
    .insert(schema.pendingOnboardings)
    .values({
      id: uuidv7(),
      discoveryRunId: options.discoveryRunId,
      input: options.input,
      language: options.language,
      timezone: options.timezone ?? null,
      channel: "email", // Default, will be updated when user chooses
      ipHash: options.ipHash,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new AppError("internal_error", "Failed to create pending onboarding");
  }
  return row as PendingOnboarding;
}

/** Get a pending onboarding by ID (from cookie). */
export async function getPendingOnboarding(
  db: Queryable,
  id: string,
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .select()
    .from(schema.pendingOnboardings)
    .where(
      and(
        eq(schema.pendingOnboardings.id, id),
        isNull(schema.pendingOnboardings.consumedAt),
        gte(schema.pendingOnboardings.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row as PendingOnboarding | undefined;
}

/** Update pending onboarding with discovery result. */
export async function updatePendingDiscoveryResult(
  db: Queryable,
  id: string,
  /** The discovery package's result; stored as JSON and re-validated when read. */
  result: DiscoveryResult | Readonly<Record<string, unknown>>,
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .update(schema.pendingOnboardings)
    .set({ result, discoveryError: null, updatedAt: new Date() })
    .where(eq(schema.pendingOnboardings.id, id))
    .returning();
  return row as PendingOnboarding | undefined;
}

/** Update pending onboarding with user's channel choice and email. */
export async function updatePendingChannel(
  db: Queryable,
  id: string,
  options: {
    readonly channel: OnboardingChannel;
    readonly emailHash?: string;
  },
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .update(schema.pendingOnboardings)
    .set({
      channel: options.channel,
      emailHash: options.emailHash ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.pendingOnboardings.id, id))
    .returning();
  return row as PendingOnboarding | undefined;
}

/** Mark pending onboarding as consumed (magic link clicked). */
export async function consumePendingOnboarding(
  db: Queryable,
  id: string,
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .update(schema.pendingOnboardings)
    .set({ consumedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.pendingOnboardings.id, id))
    .returning();
  return row as PendingOnboarding | undefined;
}

/** Start anonymous discovery job. Returns job data for the caller to send. */
export async function startAnonDiscovery(
  db: Queryable,
  options: {
    readonly input: string;
    readonly language: "en" | "ru";
    readonly timezone: string | undefined;
    readonly ipHash: string;
  },
): Promise<{
  readonly runId: string;
  readonly pendingId: string;
  readonly jobData?: {
    readonly queue: string;
    readonly data: {
      readonly tenantId: string;
      readonly userId: string;
      readonly input: string;
      readonly language: "en" | "ru";
      readonly pendingId: string;
    };
  };
}> {
  // Check limits
  await assertAnonDiscoveryAllowed(db, options.ipHash);

  // Check domain cache
  const cached = await findCachedDiscovery(db, options.input);
  if (cached) {
    // Create pending onboarding with cached result
    const pending = await createPendingOnboarding(db, {
      ...options,
      discoveryRunId: "cached",
    });
    await updatePendingDiscoveryResult(db, pending.id, cached);
    return { runId: "cached", pendingId: pending.id };
  }

  // Create pending onboarding first
  const pending = await createPendingOnboarding(db, {
    ...options,
    discoveryRunId: "pending", // Will be updated after job is sent
  });

  // Return job data for the caller to send
  const jobData = {
    queue: QUEUES.discoveryRun,
    data: {
      tenantId: ANON_TENANT_ID,
      userId: "anon",
      input: options.input,
      language: options.language,
      pendingId: pending.id,
    },
  };

  return { runId: "pending", pendingId: pending.id, jobData };
}

/** Delete expired pending onboardings (for maintenance job). */
export async function deleteExpiredPendingOnboardings(db: Queryable): Promise<number> {
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.pendingOnboardings)
    .where(lt(schema.pendingOnboardings.expiresAt, new Date()));
  const count = countResult?.count ?? 0;
  if (count > 0) {
    await db
      .delete(schema.pendingOnboardings)
      .where(lt(schema.pendingOnboardings.expiresAt, new Date()));
  }
  return count;
}

/** Delete consumed pending onboardings older than 24h (for maintenance job). */
export async function deleteOldConsumedPendingOnboardings(db: Queryable): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.pendingOnboardings)
    .where(
      and(
        isNotNull(schema.pendingOnboardings.consumedAt),
        lt(schema.pendingOnboardings.consumedAt, cutoff),
      ),
    );
  const count = countResult?.count ?? 0;
  if (count > 0) {
    await db
      .delete(schema.pendingOnboardings)
      .where(
        and(
          isNotNull(schema.pendingOnboardings.consumedAt),
          lt(schema.pendingOnboardings.consumedAt, cutoff),
        ),
      );
  }
  return count;
}

/** Discovery could not read the site: the progress page shows this and offers to try again. */
export async function recordPendingDiscoveryFailure(
  db: Queryable,
  id: string,
  message: string,
): Promise<void> {
  await db
    .update(schema.pendingOnboardings)
    .set({ discoveryError: message, updatedAt: new Date() })
    .where(eq(schema.pendingOnboardings.id, id));
}

/** The profile as the person confirmed it on the review screen. */
export async function savePendingReview(
  db: Queryable,
  id: string,
  reviewed: unknown,
): Promise<void> {
  await db
    .update(schema.pendingOnboardings)
    .set({ reviewed, updatedAt: new Date() })
    .where(eq(schema.pendingOnboardings.id, id));
}
