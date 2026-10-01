/**
 * `npm run radar:sync` — bring the radar tenant in line with `radar/*.yaml`.
 *
 * Needs RADAR_TENANT_ID. Safe to run any number of times: it only adds
 * targets and sources (see `syncRadar`). A file that does not parse stops the
 * command before anything is written.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "@mifluent/core";
import { parseRadarFile, type RadarFile, syncRadar } from "@mifluent/domain";
import { parse } from "yaml";
import { getDatabase, logger } from "./runtime.js";

const RADAR_DIR = join(import.meta.dirname, "..", "..", "..", "radar");

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

try {
  const tenantId = getConfig().RADAR_TENANT_ID;
  if (tenantId === undefined) {
    throw new Error("Set RADAR_TENANT_ID to the radar account's tenant id first.");
  }

  const files: Array<{ name: string; file: RadarFile }> = [];
  for (const name of readdirSync(RADAR_DIR)
    .filter((entry) => entry.endsWith(".yaml"))
    .sort()) {
    const parsed = parseRadarFile(parse(readFileSync(join(RADAR_DIR, name), "utf8")));
    if (!parsed.ok) throw new Error(`${name}: ${parsed.error}`);
    files.push({ name, file: parsed.file });
  }

  for (const { name, file } of files) {
    const result = await syncRadar(getDatabase(), tenantId, file);
    say(`${name} → "${file.profile.name}"${result.profileCreated ? " (new profile)" : ""}`);
    say(`  targets created: ${result.targetsCreated}, sources created: ${result.sourcesCreated}`);
    if (result.companiesWithoutSurfaces.length > 0) {
      say(`  no surfaces yet: ${result.companiesWithoutSurfaces.join(", ")}`);
    }
    logger.info("radar.synced", { file: name, ...result });
  }
  process.exit(0);
} catch (error) {
  logger.error("radar.sync_failed", { cause: error });
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
