/**
 * Embedding benchmark: 200 chunks through the local model.
 *
 * Prints seconds per chunk and the process's resident memory, the two numbers
 * TASK-006 sets limits on (≤ 0.3 s/chunk on one CPU, ≤ 800 MB). RSS rather than
 * heap: the model's weights live outside the JavaScript heap, and heap alone
 * would report a number far below what the server actually has to hold.
 *
 * Usage: npm run embed:bench
 */

import { getEmbedder } from "./runtime.js";

const CHUNK_COUNT = 200;
const MAX_SECONDS_PER_CHUNK = 0.3;
const MAX_RSS_MB = 800;

const TOPICS = [
  "a price change on the Pro plan",
  "a new integration with Shopify",
  "an outage in the EU region",
  "новый тариф для небольших команд",
  "изменение правил маркетплейса",
];

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function sampleChunk(index: number): string {
  const topic = TOPICS[index % TOPICS.length] ?? "";
  // About 400 tokens, the chunk size the pipeline produces.
  return `Chunk ${index} about ${topic}. ${"This paragraph discusses the change in some detail. ".repeat(30)}`;
}

async function main(): Promise<void> {
  const provider = getEmbedder();
  const chunks = Array.from({ length: CHUNK_COUNT }, (_, index) => sampleChunk(index));

  say(`Model: ${provider.model} (${provider.dimensions} dimensions)`);
  say("Loading and warming up…");
  await provider.embedPassage(chunks.slice(0, 4));

  const startedAt = performance.now();
  await provider.embedPassage(chunks);
  const seconds = (performance.now() - startedAt) / 1000;

  const perChunk = seconds / CHUNK_COUNT;
  const rssMb = process.memoryUsage().rss / 1024 / 1024;

  say(`Chunks:        ${CHUNK_COUNT}`);
  say(`Total:         ${seconds.toFixed(1)} s`);
  say(
    `Per chunk:     ${perChunk.toFixed(3)} s   (limit ${MAX_SECONDS_PER_CHUNK} s) ${perChunk <= MAX_SECONDS_PER_CHUNK ? "✓" : "✗"}`,
  );
  say(
    `Process RSS:   ${rssMb.toFixed(0)} MB  (limit ${MAX_RSS_MB} MB) ${rssMb <= MAX_RSS_MB ? "✓" : "✗"}`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
