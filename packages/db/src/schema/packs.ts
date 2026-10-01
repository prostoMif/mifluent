/**
 * Source packs: shared feeds that many profiles want and nobody should poll
 * twice — a marketplace's rules page, a tax authority's news, a niche's trade
 * press.
 *
 * A pack's sources are ordinary `sources` rows owned by one service tenant
 * (see `PACKS_TENANT_ID` in `@mifluent/domain`), so polling, embedding and
 * pruning need no special case. These two tables are the instance-wide
 * catalogue on top: what each pack is for, and which of the service tenant's
 * sources belong to it. They hold no tenant data, which is why they carry no
 * `tenant_id`; a profile's link to a pack is computed from its facts at
 * selection time, not stored.
 */

import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { sources } from "./sources.js";

/** The matching rules of a pack, as loaded from its YAML file. */
export interface SourcePackDefinition {
  readonly title: { readonly ru: string; readonly en: string };
  readonly market: "ru" | "en";
  /** ISO 3166-1 alpha-2 codes, or `["*"]` for every country of the market. */
  readonly countries: readonly string[];
  /** ISO 3166-2 codes; empty means the whole country. */
  readonly regions: readonly string[];
  /** Which of a profile's countries the pack follows. */
  readonly appliesTo: "home" | "sales" | "any";
  readonly kind: "platform" | "regulator" | "media" | "niche_media" | "events";
  /** Niche keys from `packs/niches.yaml`; empty means every niche. */
  readonly niches: readonly string[];
  readonly appliesWhen: {
    readonly platformsAny: readonly string[];
    readonly nichesAny: readonly string[];
  };
  readonly maxCardsPerDigest: number;
}

export const sourcePacks = pgTable("source_packs", {
  /** `ru.platforms.wildberries` — stable, used in config and in issues. */
  key: text("key").primaryKey(),
  definition: jsonb("definition").$type<SourcePackDefinition>().notNull(),
  /** When `packs:sync` last saw this pack in the repository. */
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

export const packSources = pgTable(
  "pack_sources",
  {
    id: id(),
    packKey: text("pack_key")
      .notNull()
      .references(() => sourcePacks.key, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    uniqueIndex("pack_sources_pack_source_unique").on(table.packKey, table.sourceId),
    index("pack_sources_source_idx").on(table.sourceId),
  ],
);
