/**
 * Bring the radar tenant in line with a radar file: the profile exists, every
 * company is a target, every listed surface is a source. Idempotent, and it
 * only adds: a company removed from the file keeps its target and history,
 * so its public page does not break.
 *
 * The radar is our own tenant, so the plan's target limit does not apply to
 * it — the owner sets its plan by hand.
 */

import { uuidv7 } from "@mifluent/core";
import { type Database, schema, scopedAlive } from "@mifluent/db";
import { eq } from "drizzle-orm";
import { recordVersionIfChanged } from "../profiles/write.js";
import type { RadarFile } from "./files.js";

export interface RadarSyncResult {
  readonly profileId: string;
  readonly profileCreated: boolean;
  readonly targetsCreated: number;
  readonly sourcesCreated: number;
  /** Companies with no surface yet: nothing is fetched for them until one is added. */
  readonly companiesWithoutSurfaces: readonly string[];
}

const SOURCE_KIND = { feed: "rss", query: "rss", diff: "diff" } as const;

export async function syncRadar(
  db: Database,
  tenantId: string,
  file: RadarFile,
): Promise<RadarSyncResult> {
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: schema.watchProfiles.id })
      .from(schema.watchProfiles)
      .where(
        scopedAlive(
          schema.watchProfiles,
          tenantId,
          eq(schema.watchProfiles.name, file.profile.name),
        ),
      )
      .limit(1);

    const profileId = existing?.id ?? uuidv7();
    if (existing === undefined) {
      await transaction.insert(schema.watchProfiles).values({
        id: profileId,
        tenantId,
        name: file.profile.name,
        businessDescription: file.profile.description,
        relevanceThreshold: 0.5,
        facts: { language: file.profile.language, market: file.profile.language },
      });
    }

    const targets = await transaction
      .select({ id: schema.watchTargets.id, name: schema.watchTargets.name })
      .from(schema.watchTargets)
      .where(
        scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.profileId, profileId)),
      );
    const targetIds = new Map(targets.map((target) => [target.name.toLowerCase(), target.id]));

    const sources = await transaction
      .select({ kind: schema.sources.kind, locator: schema.sources.locator })
      .from(schema.sources)
      .where(scopedAlive(schema.sources, tenantId, eq(schema.sources.profileId, profileId)));
    const knownSources = new Set(sources.map((source) => `${source.kind} ${source.locator}`));

    let targetsCreated = 0;
    let sourcesCreated = 0;
    for (const company of file.companies) {
      let targetId = targetIds.get(company.name.toLowerCase());
      if (targetId === undefined) {
        targetId = uuidv7();
        targetsCreated += 1;
        targetIds.set(company.name.toLowerCase(), targetId);
        await transaction.insert(schema.watchTargets).values({
          id: targetId,
          tenantId,
          profileId,
          kind: "competitor",
          name: company.name,
          websiteUrl: company.website,
          reason: company.category,
        });
      }

      for (const surface of company.surfaces) {
        const kind = SOURCE_KIND[surface.type];
        const key = `${kind} ${surface.url}`;
        if (knownSources.has(key)) continue;
        knownSources.add(key);
        sourcesCreated += 1;
        await transaction.insert(schema.sources).values({
          id: uuidv7(),
          tenantId,
          profileId,
          targetId,
          kind,
          label: `${company.name} — ${surface.label}`.slice(0, 120),
          locator: surface.url,
          pollIntervalMinutes: surface.interval_minutes,
        });
      }
    }

    await recordVersionIfChanged(transaction, tenantId, profileId, "Radar file synced");

    return {
      profileId,
      profileCreated: existing === undefined,
      targetsCreated,
      sourcesCreated,
      companiesWithoutSurfaces: file.companies
        .filter((company) => company.surfaces.length === 0)
        .map((company) => company.name),
    };
  });
}
