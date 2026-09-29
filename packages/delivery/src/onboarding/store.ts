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
import type { OnboardingStep, PendingOnboarding } from "@mifluent/db/schema";
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
): Promise<PendingOnboarding> {
  const now = new Date();
  const [row] = await db
    .insert(schema.pendingOnboardings)
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
  return row as PendingOnboarding;
}

/** Get the pending onboarding for a chat, if any. */
export async function getPendingOnboarding(
  db: Queryable,
  chatId: string,
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .select()
    .from(schema.pendingOnboardings)
    .where(eq(schema.pendingOnboardings.chatId, chatId))
    .limit(1);
  return row as PendingOnboarding | undefined;
}

/** Update the step and any other fields. */
export async function updatePendingOnboarding(
  db: Queryable,
  chatId: string,
  updates: Partial<{
    readonly step: OnboardingStep;
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
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .update(schema.pendingOnboardings)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.pendingOnboardings.chatId, chatId))
    .returning();
  return row as PendingOnboarding | undefined;
}

/** Delete the pending onboarding (on completion or abandonment). */
export async function deletePendingOnboarding(db: Queryable, chatId: string): Promise<void> {
  await db.delete(schema.pendingOnboardings).where(eq(schema.pendingOnboardings.chatId, chatId));
}

/** Find a pending onboarding by Telegram user ID (for "two chats one person" case). */
export async function findPendingOnboardingByTelegramUser(
  db: Queryable,
  telegramUserId: string,
): Promise<PendingOnboarding | undefined> {
  const [row] = await db
    .select()
    .from(schema.pendingOnboardings)
    .where(
      and(
        eq(schema.pendingOnboardings.telegramUserId, telegramUserId),
        isNull(schema.pendingOnboardings.deletedAt),
      ),
    )
    .limit(1);
  return row as PendingOnboarding | undefined;
}
