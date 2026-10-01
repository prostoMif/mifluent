/**
 * Read every source pack file under `packs/` and validate it.
 *
 * Shared by `packs:sync` and `packs:verify`. A file that does not parse stops
 * the whole command with the file name and the failing fields: syncing half a
 * catalogue would leave profiles following packs that silently lost sources.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { type PackFile, parsePackFile } from "@mifluent/domain";
import { parse } from "yaml";

/** Repository root, relative to this file in `apps/worker/src`. */
const PACKS_DIR = join(import.meta.dirname, "..", "..", "..", "packs");

export interface LoadedPack {
  readonly path: string;
  readonly pack: PackFile;
}

export function loadPackFiles(directory: string = PACKS_DIR): LoadedPack[] {
  const files = listYamlFiles(directory);
  const loaded = files.map((file) => {
    const path = relative(directory, file);
    return { path, pack: parsePackFile(path, parse(readFileSync(file, "utf8"))) };
  });

  assertUniqueKeys(loaded);
  return loaded;
}

function listYamlFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listYamlFiles(path));
    else if (entry.name.endsWith(".yaml")) found.push(path);
  }
  return found.sort();
}

function assertUniqueKeys(loaded: readonly LoadedPack[]): void {
  const seen = new Map<string, string>();
  for (const { path, pack } of loaded) {
    const previous = seen.get(pack.key);
    if (previous !== undefined) {
      throw new Error(`Pack key "${pack.key}" is used by both ${previous} and ${path}.`);
    }
    seen.set(pack.key, path);
  }
}
