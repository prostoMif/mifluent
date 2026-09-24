/**
 * Creating a watch profile from what onboarding discovered.
 *
 * One transaction: the profile with its structural facts, the targets, a
 * source for every surface the person kept, and the first version. Half a
 * profile — targets without sources — would produce a first digest that is
 * empty for no reason the person could see.
 */

import { uuidv7 } from "@mifluent/core";
import { type Database, schema, scopedAlive } from "@mifluent/db";
import { eq } from "drizzle-orm";
import { assertProfileWithinPlan, findTenantPlan } from "../plans/limits.js";
import type { DiscoveredSurfaceInput, ProfileFromDiscoveryInput } from "./from-discovery-schema.js";
import { recordVersionIfChanged, writeChildren } from "./write.js";

export interface CreateFromDiscoveryOptions {
  readonly db: Database;
  readonly tenantId: string;
  readonly input: ProfileFromDiscoveryInput;
}

type SourceKind = "rss" | "diff" | "json";

/** A search results feed is still a feed; a JSON board and a page are their own kinds. */
const SOURCE_KIND_BY_SURFACE: Readonly<Record<DiscoveredSurfaceInput["type"], SourceKind>> = {
  feed: "rss",
  query: "rss",
  diff: "diff",
  json: "json",
};

/** The default a new profile starts from; the person tunes it later from the dry run. */
const DEFAULT_RELEVANCE_THRESHOLD = 0.5;

export async function createProfileFromDiscovery(
  options: CreateFromDiscoveryOptions,
): Promise<{ readonly profileId: string }> {
  const { db, tenantId, input } = options;
  const profileId = uuidv7();

  await db.transaction(async (transaction) => {
    await assertProfileWithinPlan(transaction, {
      tenantId,
      profileId: undefined,
      targetCount: input.targets.length,
    });

    await transaction.insert(schema.watchProfiles).values({
      id: profileId,
      tenantId,
      name: input.name,
      businessDescription: input.businessDescription,
      websiteUrl: input.websiteUrl,
      relevanceThreshold: DEFAULT_RELEVANCE_THRESHOLD,
      facts: withoutEmpty(input.facts),
    });

    await writeChildren(
      transaction,
      { tenantId, profileId },
      {
        name: input.name,
        businessDescription: input.businessDescription,
        websiteUrl: input.websiteUrl,
        relevanceThreshold: DEFAULT_RELEVANCE_THRESHOLD,
        topics: [],
        stopwords: [],
        changeReason: "Created from onboarding",
        targets: input.targets.map((target) => ({
          kind: target.kind,
          name: target.name,
          websiteUrl: target.websiteUrl,
          aliases: [],
          reason: target.reason,
        })),
      },
    );

    const targetIds = await findTargetIds(transaction, tenantId, profileId);
    const { limits } = await findTenantPlan(transaction, tenantId);
    const seen = new Set<string>();

    for (const target of input.targets) {
      for (const surface of target.surfaces) {
        const kind = SOURCE_KIND_BY_SURFACE[surface.type];
        const key = `${kind} ${surface.url}`;
        if (seen.has(key)) continue;
        seen.add(key);

        await transaction.insert(schema.sources).values({
          id: uuidv7(),
          tenantId,
          profileId,
          targetId: targetIds.get(target.name.toLowerCase()) ?? null,
          kind,
          label: `${target.name} — ${surface.label}`.slice(0, 120),
          locator: surface.url,
          pollIntervalMinutes:
            kind === "diff"
              ? Math.max(surface.pollIntervalMinutes, limits.diffIntervalMin)
              : surface.pollIntervalMinutes,
        });
      }
    }

    await recordVersionIfChanged(transaction, tenantId, profileId, "Created from onboarding");
  });

  return { profileId };
}

async function findTargetIds(
  db: Parameters<typeof writeChildren>[0],
  tenantId: string,
  profileId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.watchTargets.id, name: schema.watchTargets.name })
    .from(schema.watchTargets)
    .where(
      scopedAlive(schema.watchTargets, tenantId, eq(schema.watchTargets.profileId, profileId)),
    );
  return new Map(rows.map((row) => [row.name.toLowerCase(), row.id]));
}

function withoutEmpty(facts: ProfileFromDiscoveryInput["facts"]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined));
}
