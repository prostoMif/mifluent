/**
 * `npm run packs:verify` — fetch every source in `packs/` once and say which
 * ones work.
 *
 * A feed must parse and hold at least one item; a page watched for changes
 * must answer 200 with enough text to diff. Fetching goes through the same
 * `safeFetch` the pollers use, so a source that passes here is one the worker
 * can actually read. Exits non-zero when anything failed, so it can gate a
 * pull request that adds sources.
 *
 * It reports rather than rewriting the YAML: a contributor marks a dead source
 * `broken: <reason>` by hand, which keeps the files' comments and layout theirs.
 */

import { toAppError } from "@mifluent/core";
import type { PackSourceEntry } from "@mifluent/domain";
import { htmlToText, parseFeed, safeFetch } from "@mifluent/sources";
import { loadPackFiles } from "./packs-files.js";
import { USER_AGENT } from "./runtime.js";

/** Less text than this is a login wall, a cookie banner or a script-only page. */
const MIN_PAGE_TEXT = 300;

interface Verdict {
  readonly ok: boolean;
  readonly detail: string;
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function verify(entry: PackSourceEntry): Promise<Verdict> {
  try {
    const response = await safeFetch({ url: entry.url, userAgent: USER_AGENT });
    if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` };

    if (entry.type === "diff") {
      const length = htmlToText(response.body.toString("utf8")).length;
      return length >= MIN_PAGE_TEXT
        ? { ok: true, detail: `${length} characters of text` }
        : { ok: false, detail: `only ${length} characters of text` };
    }

    const feed = parseFeed({
      body: response.body,
      contentType: response.contentType,
      feedUrl: response.finalUrl,
    });
    return feed.items.length > 0
      ? { ok: true, detail: `${feed.items.length} items` }
      : { ok: false, detail: "feed has no items" };
  } catch (thrown) {
    const error = toAppError(thrown);
    return { ok: false, detail: `${error.code}: ${error.message}` };
  }
}

let failures = 0;
for (const { path, pack } of loadPackFiles()) {
  say(`${pack.key}  (${path})`);
  for (const entry of pack.sources) {
    if (entry.broken !== undefined) {
      say(`  skip  ${entry.url} — marked broken: ${entry.broken}`);
      continue;
    }
    const verdict = await verify(entry);
    if (!verdict.ok) failures += 1;
    say(`  ${verdict.ok ? "ok  " : "FAIL"}  ${entry.url} — ${verdict.detail}`);
  }
}

say(failures === 0 ? "\nAll sources answered." : `\n${failures} source(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
