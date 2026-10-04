/**
 * Competitors from a 2GIS export, into a customer's profile.
 *
 *   npm run leads:competitors -- <export.csv> "<the customer's name in the export>" <tenantId>
 *       [--competitors 5] [--profile <profileId>] [--dry-run]
 *
 * Discovery asks a model, which knows national brands but not the clinic two
 * streets away. The export does: the customer's competitors are the other
 * businesses of the same city and category that have a site — the same pick
 * `leads:brief` used for the first message. They are added to the profile
 * (the plan's limit holds), and their sites are probed for sources at once,
 * so the next digest already covers them.
 *
 * Find the tenant id with `npm run billing:grant -- find <email>`.
 */

import { readFileSync } from "node:fs";
import { isUuid, toAppError } from "@mifluent/core";
import { addCompetitors, listWatchProfiles, type NewCompetitor } from "@mifluent/domain";
import { findSourcesForManualTargets } from "./jobs/manual-target-sources.js";
import { fromCallerDir } from "./leads/caller-path.js";
import { competitorsFor, type Lead, readTwoGisCsv } from "./leads/two-gis-csv.js";
import { getDatabase, logger } from "./runtime.js";

const USAGE =
  'Usage: npm run leads:competitors -- <export.csv> "<customer name>" <tenantId>' +
  " [--competitors 5] [--profile <profileId>] [--dry-run]\n";

interface Options {
  readonly file: string;
  readonly customer: string;
  readonly tenantId: string;
  readonly limit: number;
  readonly profileId: string | undefined;
  readonly isDryRun: boolean;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}`);
  process.exit(1);
}

function parseOptions(argv: readonly string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--dry-run") flags.set(arg, "");
    else if (arg.startsWith("--")) flags.set(arg, argv[++index] ?? "");
    else positional.push(arg);
  }
  return validate(positional, flags);
}

function validate(positional: readonly string[], flags: ReadonlyMap<string, string>): Options {
  const [file, customer, tenantId] = positional;
  const limit = Number.parseInt(flags.get("--competitors") ?? "5", 10);
  const profileId = flags.get("--profile");
  if (file === undefined || customer === undefined)
    fail("Give the export and the customer's name.");
  if (tenantId === undefined || !isUuid(tenantId)) fail("The third argument is the tenant id.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail("--competitors is 1 to 20.");
  if (profileId !== undefined && !isUuid(profileId)) fail("--profile is a profile id.");
  return { file, customer, tenantId, limit, profileId, isDryRun: flags.has("--dry-run") };
}

/** The one row that is the customer: an exact name first, then a unique partial match. */
function findCustomer(all: readonly Lead[], name: string): Lead {
  const wanted = name.trim().toLowerCase();
  const exact = all.filter((lead) => lead.name.toLowerCase() === wanted);
  const matches =
    exact.length > 0 ? exact : all.filter((lead) => lead.name.toLowerCase().includes(wanted));
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  if (matches.length === 0) fail(`Nobody called "${name}" in the export.`);
  const listing = matches
    .slice(0, 10)
    .map((lead) => `  ${lead.name} — ${lead.address}`)
    .join("\n");
  return fail(`"${name}" matches ${matches.length} rows; be more exact:\n${listing}`);
}

async function chooseProfile(tenantId: string, profileId: string | undefined): Promise<string> {
  const profiles = await listWatchProfiles(getDatabase(), tenantId);
  if (profileId !== undefined) {
    if (!profiles.some((profile) => profile.id === profileId))
      fail("No such profile for this tenant.");
    return profileId;
  }
  const [only, ...others] = profiles;
  if (only === undefined) return fail("This tenant has no profile yet — onboarding not finished.");
  if (others.length > 0) {
    const listing = profiles.map((profile) => `  ${profile.id}  ${profile.name}`).join("\n");
    return fail(`Several profiles; pick one with --profile:\n${listing}`);
  }
  return only.id;
}

const options = parseOptions(process.argv.slice(2));
const all = readTwoGisCsv(readFileSync(fromCallerDir(options.file), "utf8"));
const customer = findCustomer(all, options.customer);
const competitors: NewCompetitor[] = competitorsFor(customer, all, options.limit).map((lead) => ({
  name: lead.name,
  websiteUrl: lead.website ?? "",
  reason:
    `Конкурент из 2ГИС: ${[lead.rubrics, lead.city].filter((part) => part !== "").join(", ")}`.slice(
      0,
      400,
    ),
}));

process.stdout.write(`${customer.name} (${customer.city}) — competitors from the export:\n`);
for (const competitor of competitors) {
  process.stdout.write(`  ${competitor.name}  ${competitor.websiteUrl}\n`);
}
if (competitors.length === 0) fail("None of the other businesses in the export has a site.");
if (options.isDryRun) process.exit(0);

try {
  const profileId = await chooseProfile(options.tenantId, options.profileId);
  const added = await addCompetitors({
    db: getDatabase(),
    tenantId: options.tenantId,
    profileId,
    competitors,
    changeReason: "Конкуренты из выгрузки 2ГИС",
  });
  process.stdout.write(`Added ${added.length} (the rest were already watched).\n`);

  const sources = await findSourcesForManualTargets({ tenantId: options.tenantId, profileId });
  process.stdout.write(`Sources found on their sites: ${sources}.\n`);
  logger.info("leads.competitors_added", {
    tenantId: options.tenantId,
    profileId,
    added: added.length,
    sources,
  });
  process.exit(0);
} catch (error) {
  const appError = toAppError(error);
  logger.error("leads.competitors_failed", { tenantId: options.tenantId, cause: error });
  process.stderr.write(
    appError.code === "plan_limit_reached"
      ? `Over the plan's limit: ${appError.message} Try fewer with --competitors.\n`
      : `Not added: ${appError.message}\n`,
  );
  process.exit(1);
}
