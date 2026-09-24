/**
 * Page snapshots for diff sources, and the material a change produces.
 *
 * The first poll of a page stores a baseline and nothing else: a page that has
 * never been seen before has not *changed*, and reporting its whole text as
 * "added" would fill the first digest with a competitor's pricing page.
 *
 * After that, a change stores a new snapshot and one raw item holding the
 * added and removed text, in one transaction — a snapshot without its item
 * would make the next diff compare against a version nobody was told about.
 */

import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped, scopedById } from "@mifluent/db";
import { desc, eq, inArray } from "drizzle-orm";

export interface StoredPageVersion {
  readonly contentHash: string;
  readonly extractedText: string;
}

/**
 * Twenty versions is several months of a weekly-changing page — enough to
 * answer "what did their pricing say in spring" and small enough that this
 * table, the one that grows on every change, stays bounded.
 */
const MAX_VERSIONS_PER_SOURCE = 20;

export async function findLatestPageVersion(
  db: Queryable,
  tenantId: string,
  sourceId: string,
): Promise<StoredPageVersion | undefined> {
  const [row] = await db
    .select({
      contentHash: schema.pageVersions.contentHash,
      extractedText: schema.pageVersions.extractedText,
    })
    .from(schema.pageVersions)
    .where(scoped(schema.pageVersions, tenantId, eq(schema.pageVersions.sourceId, sourceId)))
    .orderBy(desc(schema.pageVersions.fetchedAt))
    .limit(1);

  return row;
}

export interface PageVersionInput {
  readonly tenantId: string;
  readonly sourceId: string;
  readonly contentHash: string;
  readonly extractedText: string;
  readonly fetchedAt: Date;
}

export interface PageChangeInput extends PageVersionInput {
  readonly pageUrl: string;
  readonly label: string;
  readonly added: string;
  readonly removed: string;
  /** Stable identity for this change, so a retried poll does not store it twice. */
  readonly fingerprint: string;
}

/** The first snapshot of a page. No material: nothing has changed yet. */
export async function recordPageBaseline(db: Queryable, input: PageVersionInput): Promise<void> {
  await upsertVersion(db, input, { added: null, removed: null });
}

/** A changed page: a new snapshot and the raw item describing the change. */
export async function recordPageChange(db: Queryable, input: PageChangeInput): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const pageVersionId = await upsertVersion(transaction, input, {
      added: input.added,
      removed: input.removed,
    });

    const inserted = await transaction
      .insert(schema.rawItems)
      .values({
        id: uuidv7(),
        tenantId: input.tenantId,
        sourceId: input.sourceId,
        externalId: null,
        url: input.pageUrl,
        title: input.label,
        author: null,
        content: formatChange(input.added, input.removed),
        contentHash: input.fingerprint,
        publishedAt: input.fetchedAt,
        fetchedAt: input.fetchedAt,
        kind: "diff",
        pageVersionId,
        addedText: input.added,
        removedText: input.removed,
      })
      .onConflictDoNothing({ target: [schema.rawItems.tenantId, schema.rawItems.contentHash] })
      .returning({ id: schema.rawItems.id });

    await pruneVersions(transaction, input.tenantId, input.sourceId);
    return inserted.length > 0;
  });
}

/**
 * The text a diff item carries. The labels are part of the stored content so
 * a person reading the raw item — or a model judging it — can tell the two
 * halves apart; `added_text` and `removed_text` hold them separately.
 */
export function formatChange(added: string, removed: string): string {
  return `ADDED:\n${added}\n\nREMOVED:\n${removed}`;
}

/**
 * Insert a snapshot, or refresh one with the same text.
 *
 * A page can return to an earlier version — a sale ends and the old price
 * comes back. The unique index on (source, hash) would reject that as a
 * duplicate; refreshing the existing row instead makes it the latest again,
 * which is what the next diff has to compare against.
 */
async function upsertVersion(
  db: Queryable,
  input: PageVersionInput,
  change: { readonly added: string | null; readonly removed: string | null },
): Promise<string> {
  const [row] = await db
    .insert(schema.pageVersions)
    .values({
      id: uuidv7(),
      tenantId: input.tenantId,
      sourceId: input.sourceId,
      contentHash: input.contentHash,
      extractedText: input.extractedText,
      addedText: change.added,
      removedText: change.removed,
      fetchedAt: input.fetchedAt,
    })
    .onConflictDoUpdate({
      target: [schema.pageVersions.sourceId, schema.pageVersions.contentHash],
      set: {
        extractedText: input.extractedText,
        addedText: change.added,
        removedText: change.removed,
        fetchedAt: input.fetchedAt,
      },
    })
    .returning({ id: schema.pageVersions.id });

  if (row === undefined) {
    throw new AppError("internal_error", "Something went wrong on our side.", {
      reason: "page version upsert returned no row",
    });
  }
  return row.id;
}

async function pruneVersions(db: Queryable, tenantId: string, sourceId: string): Promise<void> {
  const stale = await db
    .select({ id: schema.pageVersions.id })
    .from(schema.pageVersions)
    .where(scoped(schema.pageVersions, tenantId, eq(schema.pageVersions.sourceId, sourceId)))
    .orderBy(desc(schema.pageVersions.fetchedAt))
    .offset(MAX_VERSIONS_PER_SOURCE);

  if (stale.length === 0) return;

  await db.delete(schema.pageVersions).where(
    scoped(
      schema.pageVersions,
      tenantId,
      inArray(
        schema.pageVersions.id,
        stale.map((row) => row.id),
      ),
    ),
  );
}

/** Replace a source's connector memory — last job list, for example. */
export async function updateSourceConfig(
  db: Queryable,
  tenantId: string,
  sourceId: string,
  config: Readonly<Record<string, unknown>>,
): Promise<void> {
  await db
    .update(schema.sources)
    .set({ config: { ...config }, updatedAt: new Date() })
    .where(scopedById(schema.sources, tenantId, sourceId));
}
