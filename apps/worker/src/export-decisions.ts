/**
 * Export a profile's decision log as JSON (TASK-015).
 *
 * Usage: npm run export:decisions -- <profileId> > decisions.json
 *
 * There is no tenant-wide export yet, and this is the part that most needs
 * one: the decision log is the reason to trust a self-hosted archive, and an
 * archive nobody can take away with them is a lock-in, not an asset.
 *
 * Writes to stdout and nothing else. The text of a decision is the most
 * sensitive thing this product stores, so it never touches the logger — an
 * operator running this command is choosing where it goes.
 */

import { isUuid } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { listDecisions } from "@mifluent/domain";
import { eq } from "drizzle-orm";
import { getDatabase } from "./runtime.js";

async function main(): Promise<void> {
  const profileId = process.argv[2] ?? "";
  if (!isUuid(profileId)) {
    process.stderr.write("Usage: npm run export:decisions -- <profileId>\n");
    process.exit(1);
  }

  const db = getDatabase();
  // An operator command run on the server: the profile id is typed by the
  // person who owns the instance, and its tenant is read from the row.
  const [profile] = await db
    .select({ tenantId: schema.watchProfiles.tenantId, name: schema.watchProfiles.name })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, profileId))
    .limit(1);

  if (profile === undefined) {
    process.stderr.write("No such profile.\n");
    process.exit(1);
  }

  const decisions = await listDecisions(db, profile.tenantId, profileId);

  process.stdout.write(
    `${JSON.stringify(
      {
        profile: { id: profileId, name: profile.name },
        exportedAt: new Date().toISOString(),
        decisions: decisions.map((decision) => ({
          id: decision.id,
          createdAt: decision.createdAt.toISOString(),
          text: decision.text,
          revisitAt: decision.revisitAt?.toISOString() ?? null,
          target:
            decision.targetId === null
              ? null
              : { id: decision.targetId, name: decision.targetName },
          event:
            decision.eventId === null
              ? null
              : { id: decision.eventId, summary: decision.eventSummary },
        })),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Export failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
