/**
 * Sources for targets that have none yet — competitors added by hand, from a
 * 2GIS export or the review screen. Used by a profile's first run and by
 * `npm run leads:competitors`.
 */

import { toAppError } from "@mifluent/core";
import { createProber, findTargetSurfaces } from "@mifluent/discovery";
import { createSource, type FirstRunJob, listTargetsWithoutSources } from "@mifluent/domain";
import { loadProfileContext } from "@mifluent/pipeline";
import { getDatabase, getRsshubHostname, logger, USER_AGENT } from "../runtime.js";

/**
 * A competitor added by hand has a site and nothing else. The same heuristics
 * discovery uses find where to watch it, and every verified surface becomes a
 * source before the first poll.
 */
export async function findSourcesForManualTargets(ref: FirstRunJob): Promise<number> {
  const db = getDatabase();
  const targets = await listTargetsWithoutSources(db, ref.tenantId, ref.profileId);
  if (targets.length === 0) return 0;

  const context = await loadProfileContext(db, ref.tenantId, ref.profileId);
  const prober = createProber({
    userAgent: USER_AGENT,
    logger,
    allowedInternalHost: getRsshubHostname(),
  });

  let created = 0;
  for (const target of targets) {
    const surfaces = await findTargetSurfaces(target, {
      prober,
      language: context?.language ?? "en",
    });
    for (const surface of surfaces.filter((candidate) => candidate.verified)) {
      try {
        await createSource({
          db,
          tenantId: ref.tenantId,
          profileId: ref.profileId,
          targetId: target.id,
          input: {
            kind: surface.type === "diff" ? "diff" : surface.type === "json" ? "json" : "rss",
            label: `${target.name} — ${surface.label}`.slice(0, 120),
            locator: surface.url,
            pollIntervalMinutes: surface.pollIntervalMinutes,
          },
        });
        created += 1;
      } catch (thrown) {
        // A duplicate of a source the profile already has is fine to skip;
        // anything else is logged and the run goes on with what it has.
        logger.warn("profile.surface_skipped", { ...ref, code: toAppError(thrown).code });
      }
    }
  }
  return created;
}
