/**
 * Signing up inside Telegram: an account whose identity is the Telegram
 * user, a pending onboarding that remembers the chat, and the step that turns
 * it into a tenant, a profile and a chat that receives the digest.
 *
 * Two ways in share it: the bot's own dialogue (`/start`, then a site), and
 * the deep link from the site's start page when the visitor picked Telegram.
 *
 * // TODO: security review — Telegram identity
 */

import { uuidv7 } from "@mifluent/core";
import type { Database, Queryable } from "@mifluent/db";
import { schema, scopedAlive } from "@mifluent/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { type CompletedOnboarding, completePendingOnboarding } from "./complete.js";
import { hashIp, startAnonDiscovery } from "./pending.js";

/** The account for a Telegram user: found by their Telegram id, or made with no email of its own. */
export async function ensureTelegramUser(
  db: Queryable,
  input: { readonly telegramUserId: string; readonly name: string },
): Promise<string> {
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.telegramUserId, input.telegramUserId))
    .limit(1);
  if (existing !== undefined) return existing.id;

  const id = uuidv7();
  await db.insert(schema.user).values({
    id,
    name: input.name.slice(0, 120),
    // Better Auth needs a unique address; this one can never receive mail
    // (.invalid is reserved), so no link can be sent to it.
    email: `telegram-${input.telegramUserId}@telegram.invalid`,
    emailVerified: false,
    telegramUserId: input.telegramUserId,
  });
  return id;
}

/** Whether this Telegram user already has an account here. */
export async function hasTelegramAccount(db: Queryable, telegramUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.user.id))
    .where(
      and(eq(schema.user.telegramUserId, telegramUserId), isNull(schema.memberships.deletedAt)),
    )
    .limit(1);
  return row !== undefined;
}

/** A sign-up this Telegram user has running: discovery not finished, not confirmed. */
export async function findRunningTelegramSignup(db: Queryable, telegramUserId: string) {
  const [row] = await db
    .select()
    .from(schema.pendingOnboardings)
    .where(
      and(
        eq(schema.pendingOnboardings.telegramUserId, telegramUserId),
        isNull(schema.pendingOnboardings.consumedAt),
        isNull(schema.pendingOnboardings.result),
        isNull(schema.pendingOnboardings.discoveryError),
        gte(schema.pendingOnboardings.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.pendingOnboardings.createdAt))
    .limit(1);
  return row;
}

/**
 * Start discovery for a site sent to the bot. Limited per Telegram user the
 * way the site limits per address. Returns the job to queue, or none when a
 * recent discovery of the same site was reused (the result is already there).
 */
export async function startTelegramSignup(
  db: Queryable,
  input: {
    readonly chatId: string;
    readonly telegramUserId: string;
    readonly text: string;
    readonly language: "en" | "ru";
  },
) {
  const started = await startAnonDiscovery(db, {
    input: input.text,
    language: input.language,
    timezone: input.language === "ru" ? "Europe/Moscow" : undefined,
    ipHash: hashIp(`telegram:${input.telegramUserId}`),
  });
  await db
    .update(schema.pendingOnboardings)
    .set({
      channel: "telegram",
      telegramChatId: input.chatId,
      telegramUserId: input.telegramUserId,
      updatedAt: new Date(),
    })
    .where(eq(schema.pendingOnboardings.id, started.pendingId));
  return started;
}

/**
 * The site's start page sent the visitor here with their pending id. The
 * first Telegram user to open the link claims it; nobody else can after that.
 */
export async function claimPendingForTelegram(
  db: Queryable,
  input: { readonly pendingId: string; readonly chatId: string; readonly telegramUserId: string },
): Promise<boolean> {
  const claimed = await db
    .update(schema.pendingOnboardings)
    .set({
      telegramChatId: input.chatId,
      telegramUserId: input.telegramUserId,
      channel: "telegram",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pendingOnboardings.id, input.pendingId),
        isNull(schema.pendingOnboardings.consumedAt),
        gte(schema.pendingOnboardings.expiresAt, new Date()),
        sql`(${schema.pendingOnboardings.telegramUserId} is null or ${schema.pendingOnboardings.telegramUserId} = ${input.telegramUserId})`,
      ),
    )
    .returning({ id: schema.pendingOnboardings.id });
  return claimed.length > 0;
}

/**
 * Confirm a Telegram sign-up: the account, the tenant and profile, and this
 * chat as where the digest goes. Only the Telegram user who claimed the
 * pending onboarding may confirm it.
 */
export async function completeTelegramSignup(
  db: Database,
  input: {
    readonly pendingId: string;
    readonly chatId: string;
    readonly telegramUserId: string;
    readonly name: string;
    readonly defaultTimezone: string;
  },
): Promise<CompletedOnboarding | undefined> {
  const [pending] = await db
    .select({ telegramUserId: schema.pendingOnboardings.telegramUserId })
    .from(schema.pendingOnboardings)
    .where(eq(schema.pendingOnboardings.id, input.pendingId))
    .limit(1);
  if (pending?.telegramUserId !== input.telegramUserId) return undefined;

  const userId = await ensureTelegramUser(db, {
    telegramUserId: input.telegramUserId,
    name: input.name,
  });
  const completed = await completePendingOnboarding(db, {
    pendingId: input.pendingId,
    userId,
    defaultTimezone: input.defaultTimezone,
  });
  if (completed === undefined) return undefined;

  await db
    .update(schema.watchProfiles)
    .set({
      delivery: sql`${schema.watchProfiles.delivery} || jsonb_build_object('telegramChatId', ${input.chatId}::text, 'channel', 'telegram')`,
      updatedAt: new Date(),
    })
    .where(
      scopedAlive(
        schema.watchProfiles,
        completed.tenantId,
        eq(schema.watchProfiles.id, completed.profileId),
      ),
    );
  return completed;
}

/** Hex without dashes, for a Telegram start parameter: `w_<32 hex>`. */
export function pendingIdToStartParam(pendingId: string): string {
  return `w_${pendingId.replaceAll("-", "")}`;
}

export function startParamToPendingId(param: string): string | undefined {
  const match = /^w_([0-9a-f]{32})$/.exec(param);
  const hex = match?.[1];
  if (hex === undefined) return undefined;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A chat was bound by code from the owner's own Telegram: remember that
 * Telegram account as the owner's, so the Mini App can sign them in. Only
 * when the owner has none yet and no other account holds that Telegram id.
 */
export async function linkOwnerTelegram(
  db: Queryable,
  tenantId: string,
  telegramUserId: string,
): Promise<void> {
  if (await isTelegramIdTaken(db, telegramUserId)) return;
  const [owner] = await db
    .select({ id: schema.user.id, telegramUserId: schema.user.telegramUserId })
    .from(schema.user)
    .innerJoin(schema.memberships, eq(schema.memberships.userId, schema.user.id))
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        eq(schema.memberships.role, "owner"),
        isNull(schema.memberships.deletedAt),
      ),
    )
    .limit(1);
  if (owner === undefined || owner.telegramUserId !== null) return;
  await db
    .update(schema.user)
    .set({ telegramUserId })
    .where(and(eq(schema.user.id, owner.id), isNull(schema.user.telegramUserId)));
}

async function isTelegramIdTaken(db: Queryable, telegramUserId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.telegramUserId, telegramUserId))
    .limit(1);
  return row !== undefined;
}
