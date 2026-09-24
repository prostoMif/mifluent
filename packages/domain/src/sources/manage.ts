/**
 * Adding, listing and removing the places material comes from.
 *
 * Sources hang off a watch profile rather than off the tenant, because the
 * question "which of these should be read for this profile" has to have an
 * answer — somebody watching two businesses does not want one feed's material
 * judged against the other's description.
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scopedAlive } from "@mifluent/db";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { findTenantPlan } from "../plans/limits.js";
import type { SourceInput, SourceStatus, SourceSummary } from "./schemas.js";

export async function listSources(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<SourceSummary[]> {
  const rows = await db
    .select({
      id: schema.sources.id,
      kind: schema.sources.kind,
      status: schema.sources.status,
      label: schema.sources.label,
      locator: schema.sources.locator,
      pollIntervalMinutes: schema.sources.pollIntervalMinutes,
      lastPolledAt: schema.sources.lastPolledAt,
      lastSucceededAt: schema.sources.lastSucceededAt,
      lastErrorMessage: schema.sources.lastErrorMessage,
      consecutiveFailures: schema.sources.consecutiveFailures,
      itemCount: count(schema.rawItems.id),
    })
    .from(schema.sources)
    // Left, not inner: a source that has found nothing yet still has to appear,
    // and it is the one the person is most likely to be wondering about.
    .leftJoin(schema.rawItems, eq(schema.rawItems.sourceId, schema.sources.id))
    .where(scopedAlive(schema.sources, tenantId, eq(schema.sources.profileId, profileId)))
    .groupBy(schema.sources.id)
    .orderBy(asc(schema.sources.createdAt));

  return rows.map((row) => ({ ...row, status: row.status as SourceStatus }));
}

export interface CreateSourceOptions {
  readonly db: Queryable;
  readonly tenantId: string;
  readonly profileId: string;
  readonly input: SourceInput;
  /** The watched company or platform this source is about, if any. */
  readonly targetId?: string | null | undefined;
}

export async function createSource(options: CreateSourceOptions): Promise<string> {
  const sourceId = uuidv7();
  const pollIntervalMinutes = await applyPlanInterval(options);

  try {
    await options.db.insert(schema.sources).values({
      id: sourceId,
      tenantId: options.tenantId,
      profileId: options.profileId,
      kind: options.input.kind,
      targetId: options.targetId ?? null,
      label: options.input.label,
      locator: options.input.locator,
      pollIntervalMinutes,
    });
  } catch (error) {
    /*
     * The unique index on (profile, kind, locator) is what makes this happen,
     * and "you already have that one" is a better answer than a driver message
     * about a constraint nobody outside the database has heard of.
     */
    throw new AppError("conflict", "That source is already on this profile.", { cause: error });
  }

  return sourceId;
}

/**
 * A page diff is a full page fetch, and the plan sets how often one may run.
 * Asking for more often is not an error — the source is simply added at the
 * fastest interval the plan allows.
 */
async function applyPlanInterval(options: CreateSourceOptions): Promise<number> {
  if (options.input.kind !== "diff") return options.input.pollIntervalMinutes;

  const { limits } = await findTenantPlan(options.db, options.tenantId);
  return Math.max(options.input.pollIntervalMinutes, limits.diffIntervalMin);
}

export async function deleteSource(
  db: Queryable,
  tenantId: string,
  sourceId: string,
): Promise<void> {
  const removed = await db
    .update(schema.sources)
    .set({ deletedAt: new Date() })
    .where(scopedAlive(schema.sources, tenantId, eq(schema.sources.id, sourceId)))
    .returning({ id: schema.sources.id });

  if (removed.length === 0) {
    throw new AppError("not_found", "Not found.");
  }
}

/** Everything a poll needs to know about one source. */
export interface PollableSource {
  readonly id: string;
  readonly tenantId: string;
  readonly profileId: string;
  readonly kind: string;
  readonly status: SourceStatus;
  readonly label: string;
  readonly locator: string | null;
  readonly pollIntervalMinutes: number;
  readonly lastPolledAt: Date | null;
  readonly consecutiveFailures: number;
  readonly etag: string | null;
  readonly lastModifiedHeader: string | null;
  readonly config: Record<string, unknown>;
}

const pollableColumns = {
  id: schema.sources.id,
  tenantId: schema.sources.tenantId,
  profileId: schema.sources.profileId,
  kind: schema.sources.kind,
  status: schema.sources.status,
  label: schema.sources.label,
  locator: schema.sources.locator,
  pollIntervalMinutes: schema.sources.pollIntervalMinutes,
  lastPolledAt: schema.sources.lastPolledAt,
  consecutiveFailures: schema.sources.consecutiveFailures,
  etag: schema.sources.etag,
  lastModifiedHeader: schema.sources.lastModifiedHeader,
  config: schema.sources.config,
};

/**
 * Every source that is still being polled, across every tenant.
 *
 * The one query in this file that is deliberately not tenant-scoped, because
 * the caller is the collector rather than a person: it works on behalf of the
 * whole instance and has no session to be scoped to. Which is exactly why it
 * lives here, named plainly, instead of being written inline somewhere.
 */
export async function listActiveSources(db: Queryable): Promise<PollableSource[]> {
  const rows = await db
    .select(pollableColumns)
    .from(schema.sources)
    .where(and(eq(schema.sources.status, "active"), isNull(schema.sources.deletedAt)))
    .orderBy(asc(schema.sources.lastPolledAt));

  return rows.map((row) => ({ ...row, status: row.status as SourceStatus }));
}

/** The active sources of one profile, for a person asking "run it now". */
export async function listProfilePollableSources(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<PollableSource[]> {
  const rows = await db
    .select(pollableColumns)
    .from(schema.sources)
    .where(
      scopedAlive(
        schema.sources,
        tenantId,
        eq(schema.sources.profileId, profileId),
        eq(schema.sources.status, "active"),
      ),
    )
    .orderBy(asc(schema.sources.createdAt));

  return rows.map((row) => ({ ...row, status: row.status as SourceStatus }));
}
