/**
 * `npm run packs:sync` — bring the database in line with the files in `packs/`.
 *
 * Safe to run any number of times: see `syncPacks`. Run it after deploying a
 * change to the pack files, and once on a new instance.
 */

import { syncPacks } from "@mifluent/domain";
import { loadPackFiles } from "./packs-files.js";
import { getDatabase, logger } from "./runtime.js";

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

try {
  const loaded = loadPackFiles();
  const result = await syncPacks(
    getDatabase(),
    loaded.map((entry) => entry.pack),
  );

  say(`${result.packs} pack(s) synced.`);
  say(`  sources created: ${result.sourcesCreated}`);
  say(`  sources reactivated: ${result.sourcesReactivated}`);
  say(`  sources paused (no longer in any file): ${result.sourcesPaused}`);
  say(`  entries skipped as broken: ${result.sourcesSkippedBroken}`);
  logger.info("packs.synced", { ...result });
  process.exit(0);
} catch (error) {
  logger.error("packs.sync_failed", { cause: error });
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
