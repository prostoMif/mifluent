/**
 * Embedding benchmark.
 *
 * Runs a local embedding benchmark with 200 chunks and reports
 * seconds per chunk and memory usage.
 */

import { createLogger } from "@mifluent/core";
import { getEmbeddingProvider } from "@mifluent/embeddings";

const CHUNK_COUNT = 200;

const logger = createLogger({ level: "info" });

function generateChunk(index: number): string {
  const topics = [
    "pricing changes",
    "new feature release",
    "security update",
    "API changes",
    "performance improvement",
    "bug fix",
    "documentation update",
    "integration added",
    "deprecation notice",
    "migration guide",
  ];
  const topic = topics[index % topics.length];
  return `${topic}: This is a test chunk for benchmarking purposes. It contains enough text to simulate a real document chunk of approximately 400 tokens. The content discusses ${topic} in detail with multiple sentences to reach the target length. `;
}

async function main(): Promise<void> {
  logger.info("embedding.bench_started", { chunkCount: CHUNK_COUNT });

  const provider = getEmbeddingProvider({ logger });

  // Generate test chunks
  const chunks = Array.from({ length: CHUNK_COUNT }, (_, i) => generateChunk(i));

  // Warm-up
  logger.info("embedding.warmup_started");
  await provider.embedPassage(chunks.slice(0, 8));
  logger.info("embedding.warmup_completed");

  // Benchmark
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage().heapUsed;

  await provider.embedPassage(chunks);

  const endTime = process.hrtime.bigint();
  const endMemory = process.memoryUsage().heapUsed;

  const durationMs = Number(endTime - startTime) / 1_000_000;
  const durationSec = durationMs / 1000;
  const memoryDeltaMB = (endMemory - startMemory) / 1024 / 1024;
  const peakMemoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
  const perChunkMs = durationMs / CHUNK_COUNT;
  const perChunkSec = perChunkMs / 1000;

  logger.info("embedding.bench_completed", {
    chunkCount: CHUNK_COUNT,
    totalDurationMs: Math.round(durationMs),
    totalDurationSec: durationSec.toFixed(2),
    perChunkMs: Math.round(perChunkMs),
    perChunkSec: perChunkSec.toFixed(4),
    memoryDeltaMB: Math.round(memoryDeltaMB * 100) / 100,
    peakMemoryMB: Math.round(peakMemoryMB * 100) / 100,
    model: "intfloat/multilingual-e5-small",
    dimensions: 384,
  });

  // Check acceptance criteria
  if (perChunkSec > 0.3) {
    logger.warn(`Per chunk time ${perChunkSec.toFixed(4)}s exceeds 0.3s target`);
  }
  if (peakMemoryMB > 800) {
    logger.warn(`Peak memory ${Math.round(peakMemoryMB)} MB exceeds 800 MB target`);
  }
}

main().catch((error) => {
  logger.error("embedding.bench_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
