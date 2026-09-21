/**
 * Tenants, membership, and who is allowed to do what.
 *
 * A tenant exists even in a single-user self-hosted install. Adding it later
 * would mean rewriting every query in the system, so it is here from the first
 * migration and costs nothing while unused.
 *
 * The `users` table is NOT defined here. Better Auth owns identity — accounts,
 * sessions, credentials, verification — and its table shapes are produced by
 * its own generator into `auth.ts` rather than written by hand. A column the
 * library expects and does not find fails at runtime inside the login flow,
 * which is the worst place to discover a typo.
 *
 * That split is deliberate: authentication is Better Auth's, tenancy is ours.
 * Better Auth has an organization plugin that would cover the tables below, but
 * it brings its own identifier and table conventions, and every domain table in
 * this schema already carries a `tenant_id` shaped the way the rest of the
 * system needs.
 */

import { relations } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";

export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);

export const tenants = pgTable(
  "tenants",
  {
    id: id(),
    name: text("name").notNull(),
    /** IANA zone, e.g. "Europe/Moscow". Storage stays UTC regardless. */
    timezone: text("timezone").notNull().default("UTC"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [index("tenants_deleted_at_idx").on(table.deletedAt)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Better Auth's user identifier — `text`, because that is what the library
     * issues. Deleting an account removes its membership rather than leaving a
     * row pointing at nothing.
     */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex("memberships_tenant_user_unique").on(table.tenantId, table.userId).where(aliveOnly),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRoleEnum("role").notNull().default("member"),
    /**
     * SHA-256 of the token, never the token itself. A leaked database backup
     * should not hand out working invitations.
     */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * Who sent it. Cleared rather than cascaded on account deletion: the
     * invitation itself stays valid, it just loses its sender.
     */
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_tenant_idx").on(table.tenantId),
  ],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, { fields: [memberships.tenantId], references: [tenants.id] }),
}));
