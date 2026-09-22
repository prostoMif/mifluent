/**
 * Embeddings provider interface and local ONNX implementation.
 *
 * The model used is intfloat/multilingual-e5-small (384 dimensions).
 * Texts for e5 require prefixes: "query: " for queries (profile targets),
 * "passage: " for passages (chunks).
 */

import type { Logger } from "@mifluent/core";

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedQuery(texts: string[]): Promise<Float32Array[]>;
  embedPassage(texts: string[]): Promise<Float32Array[]>;
}

const MODEL_NAME = "intfloat/multilingual-e5-small";
const DIMENSIONS = 384;
const DEFAULT_BATCH_SIZE = 32;

const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

let providerInstance: EmbeddingProvider | null = null;

export function getEmbeddingProvider(
  options: { modelsDir?: string | undefined; logger?: Logger | undefined; batchSize?: number } = {},
): EmbeddingProvider {
  if (providerInstance) return providerInstance;

  const { modelsDir, logger, batchSize = DEFAULT_BATCH_SIZE } = options;

  const provider = new LocalOnnxProvider({
    model: MODEL_NAME,
    dimensions: DIMENSIONS,
    modelsDir,
    logger,
    batchSize,
  });

  providerInstance = provider;
  return provider;
}

export class LocalOnnxProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  private readonly modelsDir: string;
  private readonly logger?: Logger | undefined;
  private readonly batchSize: number;
  private embedder: Promise<unknown> | null = null;
  private embedderInitialized = false;

  constructor(options: {
    model: string;
    dimensions: number;
    modelsDir?: string | undefined;
    logger?: Logger | undefined;
    batchSize?: number;
  }) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.modelsDir = options.modelsDir ?? process.env["MODELS_DIR"] ?? "~/.cache/mifluent/models";
    this.logger = options.logger;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  private async getEmbedder(): Promise<{
    embed: (
      texts: string[],
      options: { pooling: "mean"; normalize: boolean },
    ) => Promise<Float32Array[]>;
  }> {
    if (this.embedderInitialized && this.embedder) {
      return this.embedder as Promise<{
        embed: (
          texts: string[],
          options: { pooling: "mean"; normalize: boolean },
        ) => Promise<Float32Array[]>;
      }>;
    }

    this.embedderInitialized = true;
    this.embedder = this.initEmbedder();

    return this.embedder as Promise<{
      embed: (
        texts: string[],
        options: { pooling: "mean"; normalize: boolean },
      ) => Promise<Float32Array[]>;
    }>;
  }

  private async initEmbedder(): Promise<{
    embed: (
      texts: string[],
      options: { pooling: "mean"; normalize: boolean },
    ) => Promise<Float32Array[]>;
  }> {
    const startTime = Date.now();

    try {
      const { pipeline, env } = await import("@huggingface/transformers");

      // Configure cache directory
      if (this.modelsDir) {
        env.cacheDir = this.modelsDir;
      }

      // Disable telemetry
      env.allowLocalModels = true;
      env.useBrowserCache = false;

      this.logger?.info("embeddings.model_loading", {
        model: this.model,
        cacheDir: this.modelsDir,
      });

      const embedder = await pipeline("feature-extraction", this.model, {
        dtype: "q8",
        device: "cpu",
      });

      this.logger?.info("embeddings.model_loaded", {
        model: this.model,
        durationMs: Date.now() - startTime,
      });

      // Cast to the expected interface
      const embedFn = embedder as unknown as {
        embed: (
          texts: string[],
          options: { pooling: "mean"; normalize: boolean },
        ) => Promise<Float32Array[]>;
      };
      return embedFn;
    } catch (error) {
      this.logger?.error("embeddings.model_load_failed", {
        model: this.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    const embedder = await this.getEmbedder();
    const allEmbeddings: Float32Array[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchStart = Date.now();

      try {
        const embeddings = await embedder.embed(batch, {
          pooling: "mean",
          normalize: true,
        });

        this.logger?.debug("embeddings.batch_completed", {
          batchSize: batch.length,
          durationMs: Date.now() - batchStart,
        });

        allEmbeddings.push(...embeddings);
      } catch (error) {
        this.logger?.error("embeddings.batch_failed", {
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    return allEmbeddings;
  }

  async embedQuery(texts: string[]): Promise<Float32Array[]> {
    const prefixed = texts.map((t) => `${QUERY_PREFIX}${t}`);
    return this.embed(prefixed);
  }

  async embedPassage(texts: string[]): Promise<Float32Array[]> {
    const prefixed = texts.map((t) => `${PASSAGE_PREFIX}${t}`);
    return this.embed(prefixed);
  }
}
