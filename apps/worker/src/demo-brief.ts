/**
 * A personal demo brief for outreach: for each prospect's site, what their
 * competitors changed in the last two weeks, each line backed by a verbatim
 * quote from the source — plus the contact address found on the site and a
 * draft email that carries the brief.
 *
 * Usage:
 *   npm run demo:brief -- leads.txt          # one site per line
 *   npm run demo:brief -- https://plausible.io https://usefathom.com
 *   npm run demo:brief -- --lang ru leads.txt
 *
 * Writes `demo-briefs/<host>.md` and `demo-briefs/summary.csv`. Nothing is
 * stored in the database, and nothing is sent: every draft is read by a
 * person before it goes out. A quote that is not found word for word in the
 * fetched text is dropped — the demo must never put words in anyone's mouth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "@mifluent/core";
import { discover } from "@mifluent/discovery";
import { createLlmClient, type LlmClient } from "@mifluent/llm";
import { htmlToText, parseFeed, safeFetch } from "@mifluent/sources";
import { z } from "zod";
import { getRsshubHostname, logger, USER_AGENT } from "./runtime.js";

const OUT_DIR = "demo-briefs";
const LOOKBACK_DAYS = 14;
const ITEMS_PER_FEED = 6;
const MAX_ITEMS_TO_MODEL = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Candidate {
  readonly competitor: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly publishedAt: Date | null;
}

const pickSchema = z.object({
  changes: z
    .array(
      z.object({
        index: z.number().int().min(0),
        fact: z.string().min(5).max(220),
        quote: z.string().min(8).max(300),
        whyItMatters: z.string().min(5).max(220),
      }),
    )
    .max(4),
});

function parseArgs(argv: readonly string[]): { language: "en" | "ru"; sites: string[] } {
  let language: "en" | "ru" = "en";
  const sites: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--lang") {
      language = argv[index + 1] === "ru" ? "ru" : "en";
      index += 1;
    } else if (existsSync(arg)) {
      sites.push(
        ...readFileSync(arg, "utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "" && !line.startsWith("#")),
      );
    } else if (arg !== "") {
      sites.push(arg);
    }
  }
  return {
    language,
    sites: sites.map((site) => (site.startsWith("http") ? site : `https://${site}`)),
  };
}

async function fetchText(url: string): Promise<{ body: Buffer; contentType: string | undefined }> {
  const response = await safeFetch({
    url,
    userAgent: USER_AGENT,
    allowedInternalHost: getRsshubHostname(),
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
  return { body: response.body, contentType: response.contentType };
}

/** Recent items from every verified feed or news query discovery found for the competitors. */
async function collectCandidates(
  targets: Awaited<ReturnType<typeof discover>>["targets"],
): Promise<Candidate[]> {
  const since = Date.now() - LOOKBACK_DAYS * DAY_MS;
  const candidates: Candidate[] = [];
  for (const target of targets) {
    if (target.kind === "self") continue;
    for (const surface of target.surfaces) {
      if (!surface.verified || (surface.type !== "feed" && surface.type !== "query")) continue;
      try {
        const { body, contentType } = await fetchText(surface.url);
        const feed = parseFeed({ body, contentType, feedUrl: surface.url });
        const recent = feed.items
          .filter((item) => item.publishedAt === null || item.publishedAt.getTime() >= since)
          .slice(0, ITEMS_PER_FEED);
        for (const item of recent) {
          const text = [item.title, item.summary, item.content].filter(Boolean).join("\n");
          if (item.url === null || text.length < 20) continue;
          candidates.push({
            competitor: target.name,
            title: item.title ?? "",
            text: text.slice(0, 1_500),
            url: item.url,
            publishedAt: item.publishedAt,
          });
        }
      } catch (error) {
        logger.warn("demo.feed_failed", { url: surface.url, cause: error });
      }
    }
  }
  return candidates.slice(0, MAX_ITEMS_TO_MODEL);
}

/** First address on the home page or the contact page; null when none is published. */
async function findContactEmail(site: string): Promise<string | null> {
  for (const path of ["", "/contact", "/about", "/contact-us"]) {
    try {
      const { body } = await fetchText(new URL(path, site).toString());
      const html = body.toString("utf8");
      const match = /mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(html);
      if (match?.[1] !== undefined) return match[1].toLowerCase();
      const plain =
        /\b((?:hello|hi|contact|founders?|team|support|info)@[A-Z0-9.-]+\.[A-Z]{2,})\b/i.exec(
          htmlToText(html),
        );
      if (plain?.[1] !== undefined) return plain[1].toLowerCase();
    } catch {
      // Not every site has every page.
    }
  }
  return null;
}

interface Change {
  readonly competitor: string;
  readonly fact: string;
  readonly quote: string;
  readonly whyItMatters: string;
  readonly url: string;
  readonly ageDays: number | null;
}

async function pickChanges(
  llm: LlmClient,
  business: string,
  candidates: readonly Candidate[],
  language: "en" | "ru",
): Promise<Change[]> {
  if (candidates.length === 0) return [];
  const material = candidates
    .map((item, index) => `[${index}] ${item.competitor}\n${item.text}`)
    .join("\n\n---\n\n");
  const { value } = await llm.complete({
    tier: "cheap",
    system: [
      `You pick, for the business below, the most useful recent changes at its competitors:`,
      `prices, plans, product launches, policy changes, notable moves. Skip generic news.`,
      `For each: the item's [index], one plain sentence of what changed, a quote copied`,
      `character for character from that item's text, and one sentence on why it matters`,
      `to this business. At most 4. Fewer is fine; none if nothing is useful.`,
      `Write in ${language === "ru" ? "Russian" : "English"}.`,
      ``,
      `The business: ${business}`,
    ].join("\n"),
    material,
    schema: pickSchema,
    purpose: "demo",
    temperature: 0.1,
    maxOutputTokens: 1_200,
  });

  const now = Date.now();
  return value.changes.flatMap((change): Change[] => {
    const item = candidates[change.index];
    // The quote must be on the page, word for word, or the line is dropped.
    if (item === undefined || !normalise(item.text).includes(normalise(change.quote))) return [];
    return [
      {
        competitor: item.competitor,
        fact: change.fact,
        quote: change.quote,
        whyItMatters: change.whyItMatters,
        url: item.url,
        ageDays:
          item.publishedAt === null
            ? null
            : Math.max(0, Math.round((now - item.publishedAt.getTime()) / DAY_MS)),
      },
    ];
  });
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function age(days: number | null, language: "en" | "ru"): string {
  if (days === null) return "";
  if (language === "ru") return days === 0 ? "сегодня" : `${days} дн. назад`;
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function renderBrief(changes: readonly Change[], language: "en" | "ru"): string {
  return changes
    .map((change) =>
      [
        `• ${change.competitor} — ${change.fact}${change.ageDays === null ? "" : ` (${age(change.ageDays, language)})`}`,
        `  “${change.quote}”`,
        `  ${language === "ru" ? "Почему важно" : "Why it matters"}: ${change.whyItMatters}`,
        `  ${change.url}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function renderEmail(
  name: string,
  competitors: readonly string[],
  changes: readonly Change[],
  language: "en" | "ru",
  siteUrl: string,
): { subject: string; body: string } {
  const top = changes[0];
  if (language === "ru") {
    return {
      subject:
        top === undefined
          ? `${name}: за кем стоит следить`
          : `${top.competitor}: ${top.fact}`.slice(0, 90),
      body: [
        `Привет!`,
        ``,
        `Прогнал ${name} через свой сервис — он сам нашёл ваших конкурентов (${competitors.slice(0, 5).join(", ")}) и вот что у них поменялось за две недели:`,
        ``,
        renderBrief(changes, language),
        ``,
        `Такая сводка может приходить каждое утро в Telegram или на почту — только то, что изменилось, с цитатой и ссылкой. Бесплатный тариф, без карты: ${siteUrl}`,
        ``,
        `Если неинтересно — просто не отвечай, больше не напишу.`,
      ].join("\n"),
    };
  }
  return {
    subject:
      top === undefined
        ? `Who ${name} should be watching`
        : `${top.competitor}: ${top.fact}`.slice(0, 90),
    body: [
      `Hi,`,
      ``,
      `I ran ${name} through a tool I'm building. It worked out your competitors on its own (${competitors.slice(0, 5).join(", ")}) and here is what they changed in the last two weeks:`,
      ``,
      renderBrief(changes, language),
      ``,
      `It can send you this every morning — only what changed, each line quoted from the source. Free plan, no card: ${siteUrl}`,
      ``,
      `If it's not useful, just ignore this — I won't follow up more than once.`,
    ].join("\n"),
  };
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function main(): Promise<void> {
  const { language, sites } = parseArgs(process.argv.slice(2));
  if (sites.length === 0) {
    process.stderr.write("Usage: npm run demo:brief -- [--lang ru] leads.txt | https://site ...\n");
    process.exit(1);
  }
  const config = getConfig();
  if (config.LLM_BASE_URL === undefined || config.LLM_API_KEY === undefined) {
    process.stderr.write("No model configured: set LLM_BASE_URL and LLM_API_KEY.\n");
    process.exit(1);
  }

  let costUsd = 0;
  const llm = createLlmClient({
    baseUrl: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
    cheapModel: config.LLM_MODEL_CHEAP ?? "",
    deepModel: config.LLM_MODEL_DEEP ?? "",
    pricePerMillion: {
      cheapIn: config.LLM_PRICE_CHEAP_IN,
      cheapOut: config.LLM_PRICE_CHEAP_OUT,
      deepIn: config.LLM_PRICE_DEEP_IN,
      deepOut: config.LLM_PRICE_DEEP_OUT,
    },
    onUsage: async (record) => {
      costUsd += record.costUsd;
    },
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const rows = ["site,email,competitors,changes,subject,file"];

  for (const site of sites) {
    const host = new URL(site).hostname.replace(/^www\./, "");
    process.stderr.write(`→ ${host}… `);
    try {
      const found = await discover({
        input: site,
        language,
        llm,
        userAgent: USER_AGENT,
        logger,
        allowedInternalHost: getRsshubHostname(),
      });
      const competitors = found.targets
        .filter((target) => target.kind === "competitor")
        .map((target) => target.name);
      const [candidates, email] = await Promise.all([
        collectCandidates(found.targets),
        findContactEmail(site),
      ]);
      const business = `${found.business.name}: ${found.business.description}`;
      const changes = await pickChanges(llm, business, candidates, language);
      const draft = renderEmail(
        found.business.name,
        competitors,
        changes,
        language,
        config.APP_URL,
      );

      const file = join(OUT_DIR, `${host}.md`);
      writeFileSync(
        file,
        [
          `# ${found.business.name} — ${site}`,
          ``,
          `To: ${email ?? "(no address on the site — find the founder on LinkedIn / X)"}`,
          `Competitors: ${competitors.join(", ") || "—"}`,
          `Changes found: ${changes.length}${changes.length === 0 ? " — skip, or send only the competitor list" : ""}`,
          ``,
          `## Subject`,
          draft.subject,
          ``,
          `## Body`,
          draft.body,
          ``,
        ].join("\n"),
      );
      rows.push(
        [site, email ?? "", competitors.join("; "), String(changes.length), draft.subject, file]
          .map(csvCell)
          .join(","),
      );
      process.stderr.write(
        `${competitors.length} competitors, ${changes.length} changes, ${email ?? "no email"}\n`,
      );
    } catch (error) {
      process.stderr.write(`failed: ${error instanceof Error ? error.message : String(error)}\n`);
      rows.push([site, "", "", "0", "", "failed"].map(csvCell).join(","));
    }
    writeFileSync(join(OUT_DIR, "summary.csv"), `${rows.join("\n")}\n`);
  }

  process.stderr.write(`\nDone: ${OUT_DIR}/summary.csv · model cost $${costUsd.toFixed(3)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `demo:brief failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
