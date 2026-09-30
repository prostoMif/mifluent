/**
 * Database operations for pending onboarding dialogues.
 *
 * All operations are scoped to the chat_id, which is the natural key for
 * the onboarding flow. The row is created on first /start and deleted when
 * onboarding completes or is abandoned.
 */

import { uuidv7 } from "@mifluent/core";
import type { Queryable } from "@mifluent/db";
import { schema } from "@mifluent/db";
import type { PendingTelegramOnboarding, TelegramOnboardingStep } from "@mifluent/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/** Create a new pending onboarding row. */
export async function createPendingOnboarding(
  db: Queryable,
  options: {
    readonly chatId: string;
    readonly telegramUserId: string;
    readonly telegramUsername: string | undefined;
    readonly language: string;
    readonly invitationToken: string | undefined;
  },
): Promise<PendingTelegramOnboarding> {
  const now = new Date();
  const [row] = await db
    .insert(schema.pendingTelegramOnboardings)
    .values({
      id: uuidv7(),
      chatId: options.chatId,
      step: "awaiting_input",
      language: options.language,
      telegramUserId: options.telegramUserId,
      telegramUsername: options.telegramUsername ?? null,
      invitationToken: options.invitationToken ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) {
    throw new Error("Failed to create pending onboarding");
  }
  return row as PendingTelegramOnboarding;
}

/** Get the pending onboarding for a chat, if any. */
export async function getPendingOnboarding(
  db: Queryable,
  chatId: string,
): Promise<PendingTelegramOnboarding | undefined> {
  const [row] = await db
    .select()
    .from(schema.pendingTelegramOnboardings)
    .where(eq(schema.pendingTelegramOnboardings.chatId, chatId))
    .limit(1);
  return row as PendingTelegramOnboarding | undefined;
}

/** Update the step and any other fields. */
export async function updatePendingOnboarding(
  db: Queryable,
  chatId: string,
  updates: Partial<{
    readonly step: TelegramOnboardingStep;
    readonly tenantId: string | null;
    readonly discoveryJobId: string | null;
    readonly discoveryResult: string | null;
    readonly selectedTargetIds: string | null;
    readonly businessDescription: string | null;
    readonly websiteUrl: string | null;
    readonly timezone: string | null;
    readonly profileName: string | null;
    readonly errorMessage: string | null;
    readonly progressUpdateCount: number;
    readonly lastProgressUpdateAt: Date | null;
  }>,
): Promise<PendingTelegramOnboarding | undefined> {
  const [row] = await db
    .update(schema.pendingTelegramOnboardings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.pendingTelegramOnboardings.chatId, chatId))
    .returning();
  return row as PendingTelegramOnboarding | undefined;
}

/** Delete the pending onboarding (on completion or abandonment). */
export async function deletePendingOnboarding(db: Queryable, chatId: string): Promise<void> {
  await db
    .delete(schema.pendingTelegramOnboardings)
    .where(eq(schema.pendingTelegramOnboardings.chatId, chatId));
}

/** Find a pending onboarding by Telegram user ID (for "two chats one person" case). */
export async function findPendingOnboardingByTelegramUser(
  db: Queryable,
  telegramUserId: string,
): Promise<PendingTelegramOnboarding | undefined> {
  const [row] = await db
    .select()
    .from(schema.pendingTelegramOnboardings)
    .where(
      and(
        eq(schema.pendingTelegramOnboardings.telegramUserId, telegramUserId),
        isNull(schema.pendingTelegramOnboardings.deletedAt),
      ),
    )
    .limit(1);
  return row as PendingTelegramOnboarding | undefined;
}
