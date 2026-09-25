/**
 * The decision text is the most sensitive thing this product stores: it is the
 * reader's own strategy, in their own words. `docs/security.md` §8 and the
 * wiki's "Архив и лог решений" both say the same thing — it does not go to a
 * log, to telemetry, or to a model.
 *
 * Nothing about that is enforceable by a type, so it is enforced by reading
 * the code: the packages that build prompts must not know this table exists.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES = fileURLToPath(new URL("../../..", import.meta.url));

/** Everything that assembles a prompt or talks to a model. */
const MODEL_FACING = ["pipeline", "llm", "discovery", "digest"];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("the decision log", () => {
  it("is unknown to every package that talks to a model", () => {
    const offenders = MODEL_FACING.flatMap((name) =>
      sourceFiles(join(PACKAGES, name, "src")),
    ).filter((path) =>
      /\b(schema\.decisions|recordDecision|listDecisions)\b/.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });

  it("is checked against packages that actually exist", () => {
    // Without this the test above passes by reading nothing at all.
    for (const name of MODEL_FACING) {
      expect(sourceFiles(join(PACKAGES, name, "src")).length).toBeGreaterThan(0);
    }
  });
});
