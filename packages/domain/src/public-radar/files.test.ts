import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseRadarFile, slugify } from "./files.js";

const RADAR_DIR = join(import.meta.dirname, "..", "..", "..", "..", "radar");

describe("radar files", () => {
  it("makes page addresses from names in either alphabet", () => {
    expect(slugify("Notion")).toBe("notion");
    expect(slugify("Яндекс Маркет")).toBe("yandeks-market");
    expect(slugify("Т-Банк эквайринг")).toBe("t-bank-ekvayring");
  });

  it("accepts the files in radar/, with no two companies on one address", () => {
    for (const name of ["en.saas.yaml", "ru.services.yaml"]) {
      const parsed = parseRadarFile(parse(readFileSync(join(RADAR_DIR, name), "utf8")));
      expect(parsed.ok, parsed.ok ? name : `${name}: ${parsed.error}`).toBe(true);
      if (!parsed.ok) continue;
      const slugs = parsed.file.companies.map((company) => slugify(company.name));
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("names the failing field", () => {
    const parsed = parseRadarFile({ profile: { name: "x" }, companies: [] });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain("profile");
  });
});
