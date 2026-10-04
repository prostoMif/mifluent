/**
 * Add competitors to an existing profile, keeping everything already there.
 *
 * For competitors the owner found outside discovery — a 2GIS export of the
 * same city and category, where a model asked from memory knows nothing
 * about the dentist two streets away. A competitor whose name or site the
 * profile already watches is skipped, and the plan's target limit holds as
 * for any other save.
 */

import { AppError } from "@mifluent/core";
import { type Database, schema, scopedAlive } from "@mifluent/db";
import { eq } from "drizzle-orm";
import { assertProfileWithinPlan } from "../plans/limits.js";
import { listTargets } from "./read.js";
import { syncTargets } from "./reconcile.js";
import type { WatchTargetInput } from "./schemas.js";
import { recordVersionIfChanged } from "./write.js";

export interface NewCompetitor {
  readonly name: string;
  readonly websiteUrl: string;
  readonly reason: string;
}

export interface AddCompetitorsOptions {
  readonly db: Database;
  readonly tenantId: string;
  readonly profileId: string;
  readonly competitors: readonly NewCompetitor[];
  readonly changeReason: string;
}

/** The competitors actually added, in the order given. */
export async function addCompetitors(options: AddCompetitorsOptions): Promise<NewCompetitor[]> {
  const { db, tenantId, profileId } = options;

  return db.transaction(async (transaction) => {
    // The ownership check: another tenant's profile is "not found", and
    // nothing is written into it.
    const [profile] = await transaction
      .select({ id: schema.watchProfiles.id })
      .from(schema.watchProfiles)
      .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)));
    if (profile === undefined) throw new AppError("not_found", "Not found.");

    const existing = await listTargets(transaction, tenantId, profileId);
    const added = notYetWatched(options.competitors, existing);
    if (added.length === 0) return [];

    await assertProfileWithinPlan(transaction, {
      tenantId,
      profileId,
      targetCount: existing.length + added.length,
    });

    const desired: WatchTargetInput[] = [
      ...existing.map((target) => ({
        kind: target.kind,
        name: target.name,
        websiteUrl: target.websiteUrl,
        aliases: [...target.aliases],
        reason: target.reason,
      })),
      ...added.map((competitor) => ({
        kind: "competitor" as const,
        name: competitor.name,
        websiteUrl: competitor.websiteUrl,
        aliases: [],
        reason: competitor.reason,
      })),
    ];
    await syncTargets(transaction, { tenantId, profileId }, desired);
    await recordVersionIfChanged(transaction, tenantId, profileId, options.changeReason);
    return added;
  });
}

/** The competitors whose name and site the profile does not watch yet, deduplicated. */
function notYetWatched(
  competitors: readonly NewCompetitor[],
  existing: readonly { readonly name: string; readonly websiteUrl: string | null }[],
): NewCompetitor[] {
  const takenNames = new Set(existing.map((target) => target.name.toLowerCase()));
  const takenHosts = new Set(existing.flatMap((target) => hostOf(target.websiteUrl) ?? []));
  const added: NewCompetitor[] = [];
  for (const competitor of competitors) {
    const name = competitor.name.toLowerCase();
    const host = hostOf(competitor.websiteUrl);
    if (takenNames.has(name) || (host !== undefined && takenHosts.has(host))) continue;
    takenNames.add(name);
    if (host !== undefined) takenHosts.add(host);
    added.push(competitor);
  }
  return added;
}

function hostOf(url: string | null): string | undefined {
  if (url === null) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}
