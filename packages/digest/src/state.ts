/**
 * Where each digest is on its way to the reader, and which profiles are due.
 *
 * The two instance-wide reads here — pending digests and due profiles — are
 * the scheduler's, working for every tenant at once. Everything they return
 * carries its tenant, and every write that follows is scoped by it.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { findTenantPlan } from "@mifluent/domain";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { type DeliveryDefaults, isDigestDue, resolveDelivery } from "./schedule.js";

export interface DigestRef {
  readonly tenantId: string;
  readonly digestId: string;
}

export interface DueProfile {
  readonly tenantId: string;
  readonly profileId: string;
}

/** Telegram digests built but not yet sent, oldest first. */
export async function listPendingTelegramDigests(db: Queryable): Promise<DigestRef[]> {
  return db
    .select({ tenantId: schema.digests.tenantId, digestId: schema.digests.id })
    .from(schema.digests)
    .where(and(eq(schema.digests.status, "pending"), eq(schema.digests.channel, "telegram")))
    .orderBy(asc(schema.digests.createdAt));
}

export async function markDigestDelivered(db: Queryable, ref: DigestRef, now: Date): Promise<void> {
  await db
    .update(schema.digests)
    .set({ status: "delivered", deliveredAt: now, failureReason: null, updatedAt: now })
    .where(scoped(schema.digests, ref.tenantId, eq(schema.digests.id, ref.digestId)));
}

/** `reason` is a short code, never a message from an external API that might echo a token. */
export async function markDigestFailed(
  db: Queryable,
  ref: DigestRef,
  reason: string,
): Promise<void> {
  await db
    .update(schema.digests)
    .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
    .where(scoped(schema.digests, ref.tenantId, eq(schema.digests.id, ref.digestId)));
}

/** Profiles whose delivery hour, in their own timezone, is now. */
export async function findDueProfiles(
  db: Queryable,
  now: Date,
  defaults: Omit<DeliveryDefaults, "isDailyAllowed">,
): Promise<DueProfile[]> {
  const profiles = await db
    .select({
      tenantId: schema.watchProfiles.tenantId,
      profileId: schema.watchProfiles.id,
      delivery: schema.watchProfiles.delivery,
    })
    .from(schema.watchProfiles)
    .where(
      and(isNull(schema.watchProfiles.deletedAt), isNotNull(schema.watchProfiles.currentVersionId)),
    );

  const due: DueProfile[] = [];
  const dailyAllowed = new Map<string, boolean>();

  for (const profile of profiles) {
    if (!dailyAllowed.has(profile.tenantId)) {
      const { limits } = await findTenantPlan(db, profile.tenantId);
      dailyAllowed.set(profile.tenantId, limits.dailyDigest);
    }

    const delivery = resolveDelivery(profile.delivery, {
      ...defaults,
      isDailyAllowed: dailyAllowed.get(profile.tenantId) ?? false,
    });
    if (isDigestDue(delivery, now)) {
      due.push({ tenantId: profile.tenantId, profileId: profile.profileId });
    }
  }

  return due;
}
