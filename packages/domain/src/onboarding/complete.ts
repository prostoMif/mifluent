/**
 * Turning a visitor's pending onboarding into an account's first profile.
 *
 * One path for both ways in — the magic link in an email and the Telegram
 * deep link — so they cannot drift apart: the tenant is found or founded,
 * the profile is created from what the person confirmed on the review screen
 * (or from discovery as it stood, if they never edited it), and the pending
 * row is consumed in the same transaction, so a second click does nothing.
 */

import type { Database } from "@mifluent/db";
import { schema } from "@mifluent/db";
import type { DiscoveryResult } from "@mifluent/db/schema";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { getMarket } from "../geo/countries.js";
import { createProfileFromDiscovery } from "../profiles/from-discovery.js";
import {
  type ProfileFromDiscoveryInput,
  profileFromDiscoverySchema,
} from "../profiles/from-discovery-schema.js";
import { attachUserToInstance } from "../tenancy/membership.js";
import { hashEmail } from "./pending.js";

/** The profile to create: the reviewed one when there is one, else discovery's own. */
export function profileInputFromPending(pending: {
  readonly reviewed: unknown;
  readonly result: unknown;
  readonly input: string;
  readonly timezone: string | null;
}): ProfileFromDiscoveryInput | undefined {
  const reviewed = profileFromDiscoverySchema.safeParse(pending.reviewed);
  if (reviewed.success) return reviewed.data;
  if (pending.result === null || pending.result === undefined) return undefined;

  const result = pending.result as DiscoveryResult;
  const country = result.business.country;
  const candidate = {
    name: result.business.name,
    businessDescription: result.business.description,
    websiteUrl: isWebAddress(pending.input) ? pending.input : null,
    facts: {
      monetization: result.business.monetization,
      platforms: result.business.platforms,
      countries: result.business.countries,
      country,
      extraCountries: result.business.extraCountries,
      homeCountry: result.business.homeCountry,
      region: result.business.region,
      market: country === undefined ? undefined : getMarket(country),
      customerType: result.business.customerType,
      language: result.business.language,
    },
    targets: result.targets.map((target) => ({
      kind: target.kind,
      name: target.name,
      websiteUrl: target.websiteUrl,
      reason: target.reason,
      surfaces: target.surfaces
        .filter((surface) => surface.verified)
        .map((surface) => ({
          type: surface.type,
          url: surface.url,
          label: surface.label,
          pollIntervalMinutes: surface.pollIntervalMinutes,
        })),
    })),
    ...(pending.timezone === null ? {} : { timezone: pending.timezone }),
  };
  const parsed = profileFromDiscoverySchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/** The newest live pending onboarding a person started with this email. */
export async function findPendingForEmail(db: Database, email: string) {
  const [pending] = await db
    .select()
    .from(schema.pendingOnboardings)
    .where(
      and(
        eq(schema.pendingOnboardings.emailHash, hashEmail(email)),
        isNull(schema.pendingOnboardings.consumedAt),
        gte(schema.pendingOnboardings.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.pendingOnboardings.createdAt))
    .limit(1);
  return pending;
}

export interface CompletedOnboarding {
  readonly tenantId: string;
  readonly profileId: string;
}

/**
 * Create the account's tenant (if it has none) and the profile, and consume
 * the pending row. Returns undefined when the pending row is gone, already
 * used, or has nothing to build from. The caller queues the first run after
 * this returns, so the job never starts before the rows are committed.
 */
export async function completePendingOnboarding(
  db: Database,
  input: {
    readonly pendingId: string;
    readonly userId: string;
    readonly defaultTimezone: string;
  },
): Promise<CompletedOnboarding | undefined> {
  return db.transaction(async (transaction) => {
    const database = transaction as unknown as Database;
    const [pending] = await transaction
      .update(schema.pendingOnboardings)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.pendingOnboardings.id, input.pendingId),
          isNull(schema.pendingOnboardings.consumedAt),
          gte(schema.pendingOnboardings.expiresAt, new Date()),
        ),
      )
      .returning();
    if (pending === undefined) return undefined;

    const profile = profileInputFromPending(pending);
    if (profile === undefined) return undefined;

    const membership = await attachUserToInstance({
      db: database,
      userId: input.userId,
      tenantName: profile.name,
      timezone: pending.timezone ?? input.defaultTimezone,
    });
    // An account made by a magic link or from Telegram has no name, so its
    // tenant was founded as "My business"; the business has a name by now.
    await transaction
      .update(schema.tenants)
      .set({ name: profile.name, updatedAt: new Date() })
      .where(
        and(eq(schema.tenants.id, membership.tenantId), eq(schema.tenants.name, "My business")),
      );

    const { profileId } = await createProfileFromDiscovery({
      db: database,
      tenantId: membership.tenantId,
      input: profile,
    });
    return { tenantId: membership.tenantId, profileId };
  });
}

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}
