/**
 * Daily owner report: a concise Telegram message sent to the instance owner
 * at 08:00 UTC every day. Pure SQL aggregation, no model calls.
 */

import { type Queryable, schema, scoped } from "@mifluent/db";
import { and, gte, lt, sql } from "drizzle-orm";

export interface DailyOwnerReport {
  readonly generatedAt: Date;
  readonly digests: {
    readonly built: number;
    readonly delivered: number;
    readonly failed: number;
    readonly failureReasons: Record<string, number>;
  };
  readonly sources: {
    readonly polled: number;
    readonly withErrors: number;
    readonly errorLabels: readonly string[];
  };
  readonly model: {
    readonly calls: number;
    readonly costUsd: number;
    readonly capPercent: number;
  };
  readonly users: {
    readonly newTenants: number;
    readonly boundTelegram: number;
    readonly blockedBot: number;
  };
  readonly actions: {
    readonly saved: number;
    readonly notImportant: number;
    readonly notFollowing: number;
    readonly influenced: number;
    readonly openedSource: number;
  };
}

interface AggregatedData {
  totalDigestsBuilt: number;
  totalDigestsDelivered: number;
  totalDigestsFailed: number;
  failureReasons: Record<string, number>;
  totalSourcesPolled: number;
  totalSourcesWithErrors: number;
  errorLabelsSet: Set<string>;
  totalModelCalls: number;
  totalModelCostUsd: number;
  newTenants: number;
  boundTelegram: number;
  blockedBot: number;
  actionSaved: number;
  actionNotImportant: number;
  actionNotFollowing: number;
  actionInfluenced: number;
  actionOpenedSource: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayBounds(): { dayStart: Date; dayEnd: Date } {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  return { dayStart, dayEnd };
}

function getTenants(db: Queryable) {
  return db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(sql`${schema.tenants.deletedAt} IS NULL`);
}

function aggregateDigests(
  digests: { status: string; failureReason: string | null }[],
  data: AggregatedData,
): void {
  for (const d of digests) {
    if (d.status === "delivered") data.totalDigestsDelivered += 1;
    else if (d.status === "failed") {
      data.totalDigestsFailed += 1;
      if (d.failureReason) {
        data.failureReasons[d.failureReason] = (data.failureReasons[d.failureReason] ?? 0) + 1;
      }
    } else if (d.status === "pending") {
      data.totalDigestsBuilt += 1;
    }
  }
  data.totalDigestsBuilt += data.totalDigestsDelivered + data.totalDigestsFailed;
}

function aggregateSourceErrors(errors: { code: string }[], data: AggregatedData): void {
  data.totalSourcesWithErrors += errors.length;
  for (const e of errors) {
    data.errorLabelsSet.add(e.code);
  }
}

function aggregateActions(actions: { kind: string }[], data: AggregatedData): void {
  for (const a of actions) {
    switch (a.kind) {
      case "saved":
        data.actionSaved += 1;
        break;
      case "not_important":
        data.actionNotImportant += 1;
        break;
      case "not_following_target":
        data.actionNotFollowing += 1;
        break;
      case "influenced":
        data.actionInfluenced += 1;
        break;
      case "opened_source":
        data.actionOpenedSource += 1;
        break;
    }
  }
}

async function processTenant(
  db: Queryable,
  tenantId: string,
  dayStart: Date,
  dayEnd: Date,
  data: AggregatedData,
): Promise<void> {
  // Digests
  const digests = await db
    .select({
      status: schema.digests.status,
      failureReason: schema.digests.failureReason,
    })
    .from(schema.digests)
    .where(
      scoped(
        schema.digests,
        tenantId,
        gte(schema.digests.createdAt, dayStart),
        lt(schema.digests.createdAt, dayEnd),
      ),
    );
  aggregateDigests(digests, data);

  // Source errors
  const sourceErrors = await db
    .select({ code: schema.sourceErrors.code, sourceId: schema.sourceErrors.sourceId })
    .from(schema.sourceErrors)
    .where(
      scoped(
        schema.sourceErrors,
        tenantId,
        gte(schema.sourceErrors.occurredAt, dayStart),
        lt(schema.sourceErrors.occurredAt, dayEnd),
      ),
    );
  aggregateSourceErrors(sourceErrors, data);

  // Sources polled
  const sourcesPolled = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.sources)
    .where(
      scoped(
        schema.sources,
        tenantId,
        gte(schema.sources.lastPolledAt, dayStart),
        lt(schema.sources.lastPolledAt, dayEnd),
      ),
    );
  data.totalSourcesPolled += sourcesPolled[0]?.total ?? 0;

  // Model usage
  const modelUsage = await db
    .select({
      calls: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${schema.operationCosts.costUsd}), 0)::numeric`,
    })
    .from(schema.operationCosts)
    .where(
      scoped(
        schema.operationCosts,
        tenantId,
        gte(schema.operationCosts.occurredAt, dayStart),
        lt(schema.operationCosts.occurredAt, dayEnd),
      ),
    );
  data.totalModelCalls += modelUsage[0]?.calls ?? 0;
  data.totalModelCostUsd += Number(modelUsage[0]?.costUsd ?? 0);

  // New tenants
  const newTenantCount = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.tenants)
    .where(and(gte(schema.tenants.createdAt, dayStart), lt(schema.tenants.createdAt, dayEnd)));
  data.newTenants += newTenantCount[0]?.total ?? 0;

  // Bound telegram
  const boundCount = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.watchProfiles)
    .where(
      scoped(
        schema.watchProfiles,
        tenantId,
        sql`(${schema.watchProfiles.delivery}->>'telegramChatId') IS NOT NULL`,
        gte(schema.watchProfiles.createdAt, dayStart),
        lt(schema.watchProfiles.createdAt, dayEnd),
      ),
    );
  data.boundTelegram += boundCount[0]?.total ?? 0;

  // Blocked bot
  const blockedCount = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.watchProfiles)
    .where(
      scoped(
        schema.watchProfiles,
        tenantId,
        sql`(${schema.watchProfiles.delivery}->>'telegramBlockedAt') IS NOT NULL`,
        gte(sql`(${schema.watchProfiles.delivery}->>'telegramBlockedAt')::timestamptz`, dayStart),
        lt(sql`(${schema.watchProfiles.delivery}->>'telegramBlockedAt')::timestamptz`, dayEnd),
      ),
    );
  data.blockedBot += blockedCount[0]?.total ?? 0;

  // User actions
  const actions = await db
    .select({ kind: schema.userActions.kind })
    .from(schema.userActions)
    .where(
      scoped(
        schema.userActions,
        tenantId,
        gte(schema.userActions.occurredAt, dayStart),
        lt(schema.userActions.occurredAt, dayEnd),
      ),
    );
  aggregateActions(actions, data);
}

function buildReportLines(data: AggregatedData, dayStart: Date, capPercent: number): string[] {
  const lines: string[] = [];
  lines.push(`📊 *Mifluent Daily Report* — ${dayStart.toISOString().split("T")[0]}`);
  lines.push("");

  lines.push("*Digests*");
  lines.push(
    `  Built: ${data.totalDigestsBuilt}  |  Delivered: ${data.totalDigestsDelivered}  |  Failed: ${data.totalDigestsFailed}`,
  );
  if (Object.keys(data.failureReasons).length > 0) {
    const reasons = Object.entries(data.failureReasons)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([code, count]) => `${code}: ${count}`)
      .join("  |  ");
    lines.push(`  Failure reasons: ${reasons}`);
  }
  lines.push("");

  lines.push("*Sources*");
  lines.push(
    `  Polled: ${data.totalSourcesPolled}  |  With errors: ${data.totalSourcesWithErrors}`,
  );
  if (data.errorLabelsSet.size > 0) {
    const topLabels = Array.from(data.errorLabelsSet).slice(0, 5).join(", ");
    lines.push(`  Top errors: ${topLabels}`);
  }
  lines.push("");

  lines.push("*Model*");
  lines.push(
    `  Calls: ${data.totalModelCalls}  |  Cost: $${data.totalModelCostUsd.toFixed(4)}  |  Cap: ${capPercent}%`,
  );
  lines.push("");

  lines.push("*Users*");
  lines.push(
    `  New tenants: ${data.newTenants}  |  Bound Telegram: ${data.boundTelegram}  |  Blocked bot: ${data.blockedBot}`,
  );
  lines.push("");

  lines.push("*Actions*");
  lines.push(
    `  Save: ${data.actionSaved}  |  Not important: ${data.actionNotImportant}  |  Not following: ${data.actionNotFollowing}`,
  );
  lines.push(
    `  Influenced: ${data.actionInfluenced}  |  Opened source: ${data.actionOpenedSource}`,
  );

  return lines;
}

/**
 * Generates the daily owner report for the previous UTC day.
 * Returns a string ready to send via Telegram (Markdown, <4096 chars).
 */
export async function generateDailyOwnerReport(db: Queryable): Promise<string> {
  const { dayStart, dayEnd } = dayBounds();
  const tenants = await getTenants(db);

  const data: AggregatedData = {
    totalDigestsBuilt: 0,
    totalDigestsDelivered: 0,
    totalDigestsFailed: 0,
    failureReasons: {},
    totalSourcesPolled: 0,
    totalSourcesWithErrors: 0,
    errorLabelsSet: new Set<string>(),
    totalModelCalls: 0,
    totalModelCostUsd: 0,
    newTenants: 0,
    boundTelegram: 0,
    blockedBot: 0,
    actionSaved: 0,
    actionNotImportant: 0,
    actionNotFollowing: 0,
    actionInfluenced: 0,
    actionOpenedSource: 0,
  };

  for (const tenant of tenants) {
    await processTenant(db, tenant.id, dayStart, dayEnd, data);
  }

  const cap = 1; // DAILY_COST_CAP_USD default, could be fetched from config
  const capPercent = cap > 0 ? Math.round((data.totalModelCostUsd / cap) * 100) : 0;

  const lines = buildReportLines(data, dayStart, capPercent);
  return lines.join("\n");
}
