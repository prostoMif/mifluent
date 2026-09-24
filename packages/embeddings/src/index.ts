/**
 * Embeddings: an interface, and one local implementation of it.
 *
 * Local on purpose — AGENTS.md: no external embedding APIs. The model is
 * multilingual-e5-small: 384 dimensions, about 120 MB quantised, fast enough on
 * the one-CPU server the product runs on, and it reads Russian as well as
 * English. The larger models that embed better do not fit next to Postgres and
 * Node in 4 GiB.
 *
 * e5 was trained with role prefixes and is noticeably worse without them: text
 * describing what a profile wants is a `query: `, material is a `passage: `.
 * The two methods below exist so no caller has to remember which is which.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@mifluent/core";

export interface EmbeddingProvider {
  /** Stored next to every vector. Vectors from different models are never compared. */
  readonly model: string;
  readonly dimensions: number;
  /** For what a profile is looking for. */
  embedQuery(texts: readonly string[]): Promise<Float32Array[]>;
  /** For material. */
  embedPassage(texts: readonly string[]): Promise<Float32Array[]>;
}

export interface LocalProviderOptions {
  /** Where the model files are cached. Defaults to `~/.cache/mifluent/models`. */
  readonly modelsDir?: string | undefined;
  readonly logger?: Logger | undefined;
}

/**
 * The transformers.js conversion of intfloat/multilingual-e5-small. Same
 * weights; the original repository has no int8 ONNX file, which is what makes
 * the model small enough to load on the production server.
 */
export const LOCAL_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const LOCAL_EMBEDDING_DIMENSIONS = 384;

/** Batch size from TASK-006; larger batches buy little on one CPU and cost memory. */
const BATCH_SIZE = 32;

/**
 * e5's context is 512 tokens. Longer input is truncated by the tokenizer
 * anyway; cutting it here first keeps a pathological chunk from making the
 * tokenizer do work that will be thrown away.
 */
const MAX_INPUT_CHARS = 4_000;

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ readonly data: ArrayLike<number>; readonly dims: readonly number[] }>;

let shared: LocalOnnxProvider | undefined;

/**
 * One provider per process. Loading the model takes seconds and a few hundred
 * megabytes; two copies would be a leak, not a cache.
 */
export function getEmbeddingProvider(options: LocalProviderOptions = {}): EmbeddingProvider {
  shared ??= new LocalOnnxProvider(options);
  return shared;
}

export class LocalOnnxProvider implements EmbeddingProvider {
  readonly model = LOCAL_EMBEDDING_MODEL;
  readonly dimensions = LOCAL_EMBEDDING_DIMENSIONS;

  private readonly modelsDir: string;
  private readonly logger: Logger | undefined;
  private extractor: Promise<Extractor> | undefined;

  constructor(options: LocalProviderOptions = {}) {
    this.modelsDir = options.modelsDir ?? join(homedir(), ".cache", "mifluent", "models");
    this.logger = options.logger;
  }

  embedQuery(texts: readonly string[]): Promise<Float32Array[]> {
    return this.embed(texts.map((text) => `query: ${text}`));
  }

  embedPassage(texts: readonly string[]): Promise<Float32Array[]> {
    return this.embed(texts.map((text) => `passage: ${text}`));
  }

  private async embed(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const extractor = await this.loadExtractor();
    const vectors: Float32Array[] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts
        .slice(start, start + BATCH_SIZE)
        .map((text) => text.slice(0, MAX_INPUT_CHARS));
      const output = await extractor(batch, { pooling: "mean", normalize: true });
      vectors.push(...splitRows(output.data, output.dims, this.dimensions));
    }

    return vectors;
  }

  private loadExtractor(): Promise<Extractor> {
    this.extractor ??= this.createExtractor();
    return this.extractor;
  }

  private async createExtractor(): Promise<Extractor> {
    const startedAt = Date.now();
    const { env, pipeline } = await import("@huggingface/transformers");

    env.cacheDir = this.modelsDir;
    env.allowLocalModels = true;

    this.logger?.info("embeddings.model_loading", { model: this.model, cacheDir: this.modelsDir });

    try {
      const extractor = await pipeline("feature-extraction", this.model, {
        dtype: "q8",
        device: "cpu",
      });
      this.logger?.info("embeddings.model_loaded", {
        model: this.model,
        durationMs: Date.now() - startedAt,
      });
      // The pipeline's declared type is a union over every task; for
      // "feature-extraction" it is this callable, returning a Tensor.
      return extractor as unknown as Extractor;
    } catch (error) {
      // Forget the failed load, so the next call tries again instead of
      // returning the same rejected promise forever.
      this.extractor = undefined;
      throw error;
    }
  }
}

/** A `[rows, dimensions]` tensor into one vector per row. */
export function splitRows(
  data: ArrayLike<number>,
  dims: readonly number[],
  dimensions: number,
): Float32Array[] {
  const [rows = 0, width = 0] = dims;

  if (width !== dimensions || data.length !== rows * width) {
    throw new Error(
      `Embedding output has shape [${dims.join(", ")}], expected [n, ${dimensions}].`,
    );
  }

  const flat = Float32Array.from(data);
  return Array.from({ length: rows }, (_, row) => flat.slice(row * width, (row + 1) * width));
}

/** Cosine similarity. The vectors here are normalised, so this is a dot product. */
export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/** The mean of several vectors, normalised: the direction a cluster points in. */
export function centroid(vectors: readonly ArrayLike<number>[]): Float32Array {
  const first = vectors[0];
  if (first === undefined) return new Float32Array(0);

  const sum = new Float32Array(first.length);
  for (const vector of vectors) {
    for (let index = 0; index < sum.length; index += 1) {
      sum[index] = (sum[index] ?? 0) + (vector[index] ?? 0);
    }
  }

  const norm = Math.sqrt(sum.reduce((total, value) => total + value * value, 0));
  return norm === 0 ? sum : sum.map((value) => value / norm);
}
