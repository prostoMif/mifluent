/**
 * Build a profile's digest now, whatever its schedule says (TASK-009).
 *
 * Usage: npm run digest:build -- <profileId>
 *
 * Writes the digest like the scheduler would and prints what went into it.
 * Does not send it; the worker's delivery job does that.
 */

import { isUuid } from "@mifluent/core";
import { schema } from "@mifluent/db";
import { loadDigestView } from "@mifluent/digest";
import { eq } from "drizzle-orm";
import { getDatabase } from "./runtime.js";
import { buildDigestNow } from "./steps.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const profileId = process.argv[2] ?? "";
  if (!isUuid(profileId)) {
    process.stderr.write("Usage: npm run digest:build -- <profileId>\n");
    process.exit(1);
  }

  const db = getDatabase();
  // An operator command run on the server: the profile id is typed by the
  // person who owns the instance, and its tenant is read from the row.
  const [profile] = await db
    .select({ tenantId: schema.watchProfiles.tenantId })
    .from(schema.watchProfiles)
    .where(eq(schema.watchProfiles.id, profileId))
    .limit(1);

  if (profile === undefined) {
    process.stderr.write("No such profile.\n");
    process.exit(1);
  }

  const built = await buildDigestNow(db, { tenantId: profile.tenantId, profileId }, new Date());
  const view = await loadDigestView(db, profile.tenantId, built.digestId);

  say(`${built.isNew ? "Built" : "Already built"} digest ${built.digestId} (${built.channel})`);
  if (view === undefined) return;
  say(`Window:           ${view.periodStart.toISOString()} → ${view.periodEnd.toISOString()}`);
  say(`Sources checked:  ${view.sourcesChecked}`);
  say(`Items considered: ${view.itemsConsidered}`);
  say(`Cards:            ${view.cards.length}`);
  for (const card of view.cards) say(`  • ${card.headline}`);
  say(`Near misses:      ${view.nearMisses.length}`);
  for (const miss of view.nearMisses) say(`  • ${miss.title} — ${miss.reason}`);
  if (view.notices.length > 0)
    say(`Notices:          ${view.notices.map((notice) => notice.code).join(", ")}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  process.stderr.write(`Build failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
