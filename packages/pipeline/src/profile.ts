/**
 * Everything the cascade needs to know about one watch profile, read once.
 *
 * Also the profile's own vectors — one per target, one per topic, one for the
 * business itself — which the free cosine step compares material against. They
 * are cached on the profile version they were computed for, because the
 * version is exactly what changes when the texts they describe change. A
 * paused target does not create a version, so the cache also carries a hash of
 * the texts and is recomputed when pausing changes them.
 */

import { createHash } from "node:crypto";
import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import type { EmbeddingProvider } from "@mifluent/embeddings";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

export type ProfileLanguage = "en" | "ru";

export interface ProfileTarget {
  readonly id: string;
  readonly kind: "competitor" | "platform" | "condition";
  readonly name: string;
  readonly reason: string | null;
  readonly aliases: readonly string[];
}

export interface ProfileFacts {
  readonly monetization?: string | undefined;
  readonly platforms?: readonly string[] | undefined;
  readonly countries?: readonly string[] | undefined;
  readonly customerType?: string | undefined;
  readonly whatMatters?: string | undefined;
  readonly language?: ProfileLanguage | undefined;
}

export interface ProfileContext {
  readonly tenantId: string;
  readonly profileId: string;
  readonly versionId: string;
  readonly name: string;
  readonly businessDescription: string | null;
  readonly relevanceThreshold: number;
  readonly facts: ProfileFacts;
  readonly language: ProfileLanguage;
  /** Active targets only. A paused target is not matched against. */
  readonly targets: readonly ProfileTarget[];
  readonly topics: readonly { readonly label: string; readonly description: string | null }[];
  readonly stopwords: readonly string[];
}

export interface ProfileVector {
  readonly refKind: "target" | "topic" | "business";
  /** The target's id for target vectors; null otherwise. */
  readonly refId: string | null;
  readonly vector: readonly number[];
}

const factsSchema = z
  .object({
    monetization: z.string().optional(),
    platforms: z.array(z.string()).optional(),
    countries: z.array(z.string()).optional(),
    customerType: z.string().optional(),
    whatMatters: z.string().optional(),
    language: z.enum(["en", "ru"]).optional(),
  })
  .catch({});

const cachedVectorsSchema = z.object({
  model: z.string(),
  textsHash: z.string(),
  vectors: z.array(
    z.object({
      refKind: z.enum(["target", "topic", "business"]),
      refId: z.string().nullable(),
      vector: z.array(z.number()),
    }),
  ),
});

/** Null when the profile is gone or has never been saved with a version. */
export async function loadProfileContext(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<ProfileContext | undefined> {
  const [profile] = await db
    .select({
      name: schema.watchProfiles.name,
      businessDescription: schema.watchProfiles.businessDescription,
      relevanceThreshold: schema.watchProfiles.relevanceThreshold,
      facts: schema.watchProfiles.facts,
      versionId: schema.watchProfiles.currentVersionId,
    })
    .from(schema.watchProfiles)
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);

  if (profile === undefined || profile.versionId === null) return undefined;

  const [targets, topics, stopwords] = await Promise.all([
    db
      .select({
        id: schema.watchTargets.id,
        kind: schema.watchTargets.kind,
        name: schema.watchTargets.name,
        reason: schema.watchTargets.reason,
        aliases: schema.watchTargets.aliases,
      })
      .from(schema.watchTargets)
      .where(
        scopedAlive(
          schema.watchTargets,
          tenantId,
          eq(schema.watchTargets.profileId, profileId),
          isNull(schema.watchTargets.pausedAt),
        ),
      )
      .orderBy(asc(schema.watchTargets.name)),
    db
      .select({ label: schema.topics.label, description: schema.topics.description })
      .from(schema.topics)
      .where(scopedAlive(schema.topics, tenantId, eq(schema.topics.profileId, profileId)))
      .orderBy(asc(schema.topics.label)),
    db
      .select({ term: schema.stopwords.term })
      .from(schema.stopwords)
      .where(scopedAlive(schema.stopwords, tenantId, eq(schema.stopwords.profileId, profileId))),
  ]);

  const facts = factsSchema.parse(profile.facts);

  return {
    tenantId,
    profileId,
    versionId: profile.versionId,
    name: profile.name,
    businessDescription: profile.businessDescription,
    relevanceThreshold: profile.relevanceThreshold,
    facts,
    language: facts.language ?? "en",
    targets,
    topics,
    stopwords: stopwords.map((row) => row.term),
  };
}

/** The profile's vectors, from the version's cache or freshly computed and cached. */
export async function loadProfileVectors(
  db: Queryable,
  context: ProfileContext,
  provider: EmbeddingProvider,
): Promise<ProfileVector[]> {
  const texts = describeProfile(context);
  const textsHash = createHash("sha256").update(JSON.stringify(texts)).digest("hex");

  const cached = await readCachedVectors(db, context);
  if (cached !== undefined && cached.model === provider.model && cached.textsHash === textsHash) {
    return cached.vectors;
  }

  const embedded = await provider.embedQuery(texts.map((entry) => entry.text));
  const vectors = texts.flatMap((entry, index): ProfileVector[] => {
    const vector = embedded[index];
    return vector === undefined
      ? []
      : [{ refKind: entry.refKind, refId: entry.refId, vector: Array.from(vector) }];
  });

  const payload = JSON.stringify({ model: provider.model, textsHash, vectors });
  await db
    .update(schema.watchProfileVersions)
    .set({
      snapshot: sql`${schema.watchProfileVersions.snapshot} || jsonb_build_object('embeddings', ${payload}::jsonb)`,
    })
    .where(
      scoped(
        schema.watchProfileVersions,
        context.tenantId,
        eq(schema.watchProfileVersions.id, context.versionId),
      ),
    );

  return vectors;
}

interface ProfileText {
  readonly refKind: ProfileVector["refKind"];
  readonly refId: string | null;
  readonly text: string;
}

/** The sentences a profile is embedded as. Exported for tests. */
export function describeProfile(context: ProfileContext): ProfileText[] {
  const texts: ProfileText[] = context.targets.map((target) => ({
    refKind: "target",
    refId: target.id,
    text: [`${target.name}:`, target.reason ?? "", ...target.aliases].join(" ").trim(),
  }));

  for (const topic of context.topics) {
    const text = topic.description === null ? topic.label : `${topic.label}: ${topic.description}`;
    texts.push({ refKind: "topic", refId: null, text });
  }

  const business = describeBusiness(context);
  if (business !== "") {
    texts.push({ refKind: "business", refId: null, text: business });
  }

  return texts;
}

/** One line describing the business, from its description and structural facts. */
export function describeBusiness(context: ProfileContext): string {
  const { facts } = context;
  const parts = [
    context.businessDescription ?? "",
    facts.whatMatters ?? "",
    facts.customerType === undefined ? "" : `Customers: ${facts.customerType}.`,
    facts.platforms === undefined || facts.platforms.length === 0
      ? ""
      : `Runs on: ${facts.platforms.join(", ")}.`,
    facts.countries === undefined || facts.countries.length === 0
      ? ""
      : `Sells in: ${facts.countries.join(", ")}.`,
    facts.monetization === undefined ? "" : `Monetization: ${facts.monetization}.`,
  ];
  return parts.filter((part) => part.trim() !== "").join(" ");
}

async function readCachedVectors(
  db: Queryable,
  context: ProfileContext,
): Promise<z.infer<typeof cachedVectorsSchema> | undefined> {
  const [row] = await db
    .select({ embeddings: sql<unknown>`${schema.watchProfileVersions.snapshot}->'embeddings'` })
    .from(schema.watchProfileVersions)
    .where(
      scoped(
        schema.watchProfileVersions,
        context.tenantId,
        eq(schema.watchProfileVersions.id, context.versionId),
      ),
    )
    .limit(1);

  const parsed = cachedVectorsSchema.safeParse(row?.embeddings);
  return parsed.success ? parsed.data : undefined;
}

export interface ProfileRef {
  readonly tenantId: string;
  readonly profileId: string;
}

/**
 * Every live profile with a version, across the instance.
 *
 * Not tenant-scoped: the caller is the scheduler, working for the whole
 * instance, and it hands each profile on with its own tenant.
 */
export async function listRunnableProfiles(db: Queryable): Promise<ProfileRef[]> {
  const rows = await db
    .select({ tenantId: schema.watchProfiles.tenantId, profileId: schema.watchProfiles.id })
    .from(schema.watchProfiles)
    .where(
      sql`${schema.watchProfiles.deletedAt} IS NULL AND ${schema.watchProfiles.currentVersionId} IS NOT NULL`,
    );
  return rows;
}

/** A tenant's live profiles, for work that fans out from one tenant's new material. */
export async function listTenantProfiles(db: Queryable, tenantId: string): Promise<ProfileRef[]> {
  const rows = await db
    .select({ tenantId: schema.watchProfiles.tenantId, profileId: schema.watchProfiles.id })
    .from(schema.watchProfiles)
    .where(
      scopedAlive(
        schema.watchProfiles,
        tenantId,
        sql`${schema.watchProfiles.currentVersionId} IS NOT NULL`,
      ),
    );
  return rows;
}
