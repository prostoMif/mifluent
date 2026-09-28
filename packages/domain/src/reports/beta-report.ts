/**
 * Beta report: per-tenant table for the owner to gate the beta.
 * Outputs a table with one row per tenant and a summary of "returners".
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { isReturner } from "./returner-rule.js";

export interface BetaReportRow {
  readonly tenantId: string;
  readonly onboardedAt: Date;
  readonly channel: "telegram" | "email" | "web";
  readonly daysInProduct: number;
  readonly digestsDelivered: number;
  readonly activeDays: number;
  readonly totalInfluenced: number;
  readonly botBlocked: boolean;
  readonly lastActiveAt: Date | null;
  readonly isReturner: boolean;
}

/**
 * Generates the beta report for all live tenants.
 */
export async function generateBetaReport(db: Queryable): Promise<BetaReportRow[]> {
  // Get all live tenants with onboarding date (first profile created)
  const tenants = await db
    .select({
      id: schema.tenants.id,
      createdAt: schema.tenants.createdAt,
    })
    .from(schema.tenants)
    .where(sql`${schema.tenants.deletedAt} IS NULL`);

  const rows: BetaReportRow[] = [];

  for (const tenant of tenants) {
    // Find first profile (onboarding date)
    const [firstProfile] = await db
      .select({ createdAt: schema.watchProfiles.createdAt })
      .from(schema.watchProfiles)
      .where(
        scoped(schema.watchProfiles, tenant.id, sql`${schema.watchProfiles.deletedAt} IS NULL`),
      )
      .orderBy(schema.watchProfiles.createdAt)
      .limit(1);

    if (!firstProfile) continue;

    const onboardedAt = firstProfile.createdAt;
    const daysInProduct = Math.floor((Date.now() - onboardedAt.getTime()) / (1000 * 60 * 60 * 24));

    // Channel
    const [profile] = await db
      .select({ delivery: schema.watchProfiles.delivery })
      .from(schema.watchProfiles)
      .where(
        scoped(schema.watchProfiles, tenant.id, sql`${schema.watchProfiles.deletedAt} IS NULL`),
      )
      .limit(1);

    const channel = profile?.delivery?.telegramChatId ? "telegram" : "web";

    // Digests delivered
    const digestsDelivered =
      (
        await db
          .select({ total: sql<number>`count(*)::int` })
          .from(schema.digests)
          .where(scoped(schema.digests, tenant.id, eq(schema.digests.status, "delivered")))
          .limit(1)
      )[0]?.total ?? 0;

    // Active days (days with any user action in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeDays = (
      await db
        .select({ day: sql<string>`date(${schema.userActions.occurredAt})` })
        .from(schema.userActions)
        .where(
          scoped(schema.userActions, tenant.id, gte(schema.userActions.occurredAt, thirtyDaysAgo)),
        )
        .groupBy(sql`date(${schema.userActions.occurredAt})`)
    ).length;

    // Total influenced
    const totalInfluenced =
      (
        await db
          .select({ total: sql<number>`count(*)::int` })
          .from(schema.userActions)
          .where(scoped(schema.userActions, tenant.id, eq(schema.userActions.kind, "influenced")))
          .limit(1)
      )[0]?.total ?? 0;

    // Bot blocked - check delivery JSONB field
    const [blockedProfile] = await db
      .select({
        blockedAt: sql`(${schema.watchProfiles.delivery}->>'telegramBlockedAt')::timestamptz`,
      })
      .from(schema.watchProfiles)
      .where(
        scoped(
          schema.watchProfiles,
          tenant.id,
          sql`(${schema.watchProfiles.delivery}->>'telegramBlockedAt') IS NOT NULL`,
        ),
      )
      .limit(1);

    const botBlocked =
      blockedProfile?.blockedAt !== null && blockedProfile?.blockedAt !== undefined;

    // Last activity
    const [lastAction] = await db
      .select({ occurredAt: schema.userActions.occurredAt })
      .from(schema.userActions)
      .where(scoped(schema.userActions, tenant.id))
      .orderBy(desc(schema.userActions.occurredAt))
      .limit(1);

    const lastActiveAt = lastAction?.occurredAt ?? null;

    // Determine if returner
    const allActions = await db
      .select({ occurredAt: schema.userActions.occurredAt, kind: schema.userActions.kind })
      .from(schema.userActions)
      .where(scoped(schema.userActions, tenant.id))
      .orderBy(schema.userActions.occurredAt);

    const isRet = isReturner(
      onboardedAt,
      allActions.map((a) => ({ occurredAt: a.occurredAt, kind: a.kind })),
    );

    rows.push({
      tenantId: tenant.id,
      onboardedAt,
      channel,
      daysInProduct,
      digestsDelivered,
      activeDays,
      totalInfluenced,
      botBlocked,
      lastActiveAt,
      isReturner: isRet,
    });
  }

  return rows.sort((a, b) => a.onboardedAt.getTime() - b.onboardedAt.getTime());
}
