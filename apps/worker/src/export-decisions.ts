/**
 * Export decisions for a profile.
 *
 * Usage:
 *   npm run export:decisions -- <profileId>
 *
 * Outputs JSON to stdout: array of decisions with event and target info.
 */

import { schema, scoped } from "@mifluent/db";
import { desc, eq } from "drizzle-orm";
import { getDatabase } from "./runtime.js";

async function main(): Promise<void> {
  const [, , profileId] = process.argv;
  if (!profileId) {
    process.stderr.write("Usage: npm run export:decisions -- <profileId>\n");
    process.exit(1);
  }

  const db = getDatabase();

  // Get tenant from profile
  const [profile] = await db
    .select({ tenantId: schema.watchProfiles.tenantId })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, profileId))
    .limit(1);

  if (!profile) {
    process.stderr.write("Profile not found.\n");
    process.exit(1);
  }

  const decisions = await db
    .select({
      id: schema.decisions.id,
      eventId: schema.decisions.eventId,
      targetId: schema.decisions.targetId,
      text: schema.decisions.text,
      revisitAt: schema.decisions.revisitAt,
      createdAt: schema.decisions.createdAt,
      targetName: schema.watchTargets.name,
      eventSummary: schema.events.summary,
      eventKind: schema.events.kind,
    })
    .from(schema.decisions)
    .leftJoin(schema.watchTargets, eq(schema.watchTargets.id, schema.decisions.targetId))
    .leftJoin(schema.events, eq(schema.events.id, schema.decisions.eventId))
    .where(scoped(schema.decisions, profile.tenantId, eq(schema.decisions.profileId, profileId)))
    .orderBy(desc(schema.decisions.createdAt));

  process.stdout.write(`${JSON.stringify(decisions, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Export failed: ${error}\n`);
  process.exit(1);
});
