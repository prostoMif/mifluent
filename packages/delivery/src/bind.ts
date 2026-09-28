/**
 * Binding a Telegram chat to a watch profile with a one-time code.
 *
 * The person asks for a code in the app, then sends `/start <code>` to the bot.
 * Whoever holds a valid code can point a profile's digests at their chat, so:
 * eight characters from a 32-letter alphabet (a trillion combinations),
 * generated with the crypto RNG, valid for ten minutes, single use, and stored
 * only as a hash.
 *
 * // TODO: security review — authentication of the chat
 */

import { createHash, randomInt } from "node:crypto";
import { AppError, uuidv7 } from "@mifluent/core";
import { type Queryable, schema, scoped, scopedAlive } from "@mifluent/db";
import { createTelegramDigestFromWebOnly, type DigestView, loadDigestView } from "@mifluent/digest";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { TelegramApi } from "./telegram-api.js";

export interface BindingCode {
  readonly code: string;
  readonly expiresAt: Date;
}

export interface BoundProfile {
  readonly tenantId: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly language: "en" | "ru";
}

/** No 0/O or 1/I: the code is read off a screen and typed on a phone. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const FIRST_DIGEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function generateBindingCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET.charAt(randomInt(ALPHABET.length));
  }
  return code;
}

export function hashBindingCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export async function createBindingCode(
  db: Queryable,
  tenantId: string,
  profileId: string,
  now: Date = new Date(),
): Promise<BindingCode> {
  const [profile] = await db
    .select({ id: schema.watchProfiles.id })
    .from(schema.watchProfiles)
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .limit(1);

  if (profile === undefined) {
    throw new AppError("not_found", "Not found.");
  }

  const code = generateBindingCode();
  const expiresAt = new Date(now.getTime() + CODE_LIFETIME_MS);

  await db.insert(schema.telegramBindings).values({
    id: uuidv7(),
    tenantId,
    profileId,
    codeHash: hashBindingCode(code),
    expiresAt,
  });

  return { code, expiresAt };
}

async function findRecentWebOnlyDigest(
  db: Queryable,
  tenantId: string,
  profileId: string,
  since: Date,
): Promise<DigestView | undefined> {
  const [row] = await db
    .select({
      id: schema.digests.id,
      tenantId: schema.digests.tenantId,
      profileId: schema.digests.profileId,
      profileName: schema.watchProfiles.name,
      facts: schema.watchProfiles.facts,
      delivery: schema.watchProfiles.delivery,
      periodStart: schema.digests.periodStart,
      periodEnd: schema.digests.periodEnd,
      status: schema.digests.status,
      channel: schema.digests.channel,
      sourcesChecked: schema.digests.sourcesChecked,
      itemsConsidered: schema.digests.itemsConsidered,
      nearMisses: schema.digests.nearMisses,
      notices: schema.digests.notices,
    })
    .from(schema.digests)
    .innerJoin(schema.watchProfiles, eq(schema.watchProfiles.id, schema.digests.profileId))
    .where(
      scoped(
        schema.digests,
        tenantId,
        and(
          eq(schema.digests.profileId, profileId),
          eq(schema.digests.channel, "web_only"),
          ne(schema.digests.periodStart, schema.digests.periodEnd),
          sql`${schema.digests.periodEnd} >= ${since.toISOString()}::timestamptz`,
        ),
      ),
    )
    .orderBy(desc(schema.digests.periodEnd))
    .limit(1);

  if (row === undefined) return undefined;
  return loadDigestView(db, tenantId, row.id);
}

export async function deliverFirstDigestOnBind(
  db: Queryable,
  api: TelegramApi,
  tenantId: string,
  profileId: string,
  chatId: string,
  appUrl: string,
  timezone: string,
): Promise<boolean> {
  const since = new Date(Date.now() - FIRST_DIGEST_MAX_AGE_MS);
  const existingDigest = await findRecentWebOnlyDigest(db, tenantId, profileId, since);

  if (existingDigest === undefined) {
    return false;
  }

  // Send the existing digest to Telegram
  const { renderDigest } = await import("./render.js");
  const messages = renderDigest(existingDigest, { appUrl, timezone });
  for (const message of messages) {
    await api.sendMessage(chatId, message);
  }

  // Create a new telegram digest for the same window
  await createTelegramDigestFromWebOnly(db, tenantId, existingDigest.id);

  return true;
}

/**
 * Spend a code: attach the chat to the code's profile and delete the code.
 *
 * Found by hash alone — the chat has no session and no tenant. The code's own
 * row carries the tenant, and every write after the lookup is scoped by it.
 */
export async function consumeBindingCode(
  db: Queryable,
  code: string,
  chatId: string,
  now: Date = new Date(),
): Promise<BoundProfile | undefined> {
  return db.transaction(async (transaction) => {
    const [binding] = await transaction
      .delete(schema.telegramBindings)
      .where(
        and(
          eq(schema.telegramBindings.codeHash, hashBindingCode(code)),
          gt(schema.telegramBindings.expiresAt, now),
        ),
      )
      .returning({
        tenantId: schema.telegramBindings.tenantId,
        profileId: schema.telegramBindings.profileId,
      });

    if (binding === undefined) return undefined;

    const [profile] = await transaction
      .update(schema.watchProfiles)
      .set({
        delivery: sql`${schema.watchProfiles.delivery} || jsonb_build_object('telegramChatId', ${chatId}::text)`,
        updatedAt: now,
      })
      .where(
        scopedAlive(
          schema.watchProfiles,
          binding.tenantId,
          eq(schema.watchProfiles.id, binding.profileId),
        ),
      )
      .returning({ name: schema.watchProfiles.name, facts: schema.watchProfiles.facts });

    if (profile === undefined) return undefined;

    return {
      tenantId: binding.tenantId,
      profileId: binding.profileId,
      profileName: profile.name,
      language: profile.facts.language === "ru" ? "ru" : "en",
    };
  });
}

export async function unbindTelegram(
  db: Queryable,
  tenantId: string,
  profileId: string,
): Promise<void> {
  const updated = await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`${schema.watchProfiles.delivery} - 'telegramChatId'`,
      updatedAt: new Date(),
    })
    .where(scopedAlive(schema.watchProfiles, tenantId, eq(schema.watchProfiles.id, profileId)))
    .returning({ id: schema.watchProfiles.id });

  if (updated.length === 0) {
    throw new AppError("not_found", "Not found.");
  }
}

/** Remove codes nobody used. Run from the daily maintenance job. */
export async function pruneExpiredBindings(db: Queryable, now: Date = new Date()): Promise<void> {
  await db.delete(schema.telegramBindings).where(lt(schema.telegramBindings.expiresAt, now));
}
