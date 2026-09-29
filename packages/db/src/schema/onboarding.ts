/**
 * Pending onboarding dialogues.
 *
 * The onboarding flow runs entirely in Telegram and must survive a worker
 * restart. Every step writes its state here, keyed by the chat id. The row is
 * deleted when onboarding finishes or is abandoned.
 */

import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";
import { tenants } from "./tenancy.js";

export const onboardingStepEnum = pgEnum("onboarding_step", [
  /** Waiting for the user to send a website URL or business description. */
  "awaiting_input",
  /** Discovery is running; the user sees progress updates. */
  "discovering",
  /** Discovery completed; showing the listing with toggle buttons. */
  "listing",
  /** User is choosing a timezone. */
  "choosing_timezone",
  /** Onboarding completed; the row is kept briefly for idempotency. */
  "completed",
]);

export const pendingOnboardings = pgTable(
  "pending_onboardings",
  {
    id: id(),
    /** The Telegram chat this onboarding belongs to. */
    chatId: text("chat_id").notNull(),
    /** The tenant this onboarding will create or join. Null until known. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** Current step of the onboarding flow. */
    step: onboardingStepEnum("step").notNull().default("awaiting_input"),
    /** Language code from Telegram (e.g., "ru", "en"). */
    language: text("language").notNull().default("en"),
    /** Telegram user ID of the person onboarding. */
    telegramUserId: text("telegram_user_id").notNull(),
    /** Telegram username if available. */
    telegramUsername: text("telegram_username"),
    /** Invitation token if the user started with one. */
    invitationToken: text("invitation_token"),
    /** Discovery job ID while discovery is running. */
    discoveryJobId: text("discovery_job_id"),
    /** Discovery result (JSON) once completed. */
    discoveryResult: text("discovery_result"),
    /** Selected target IDs from the listing (JSON array). */
    selectedTargetIds: text("selected_target_ids"),
    /** Business description provided by the user (for text input). */
    businessDescription: text("business_description"),
    /** Website URL provided by the user. */
    websiteUrl: text("website_url"),
    /** Timezone chosen by the user. */
    timezone: text("timezone"),
    /** Profile name chosen by the user. */
    profileName: text("profile_name"),
    /** Error message if discovery failed. */
    errorMessage: text("error_message"),
    /** How many progress updates have been sent (for throttling). */
    progressUpdateCount: integer("progress_update_count").notNull().default(0),
    /** Timestamp of the last progress update. */
    lastProgressUpdateAt: timestamp("last_progress_update_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex("pending_onboardings_chat_id_unique").on(table.chatId).where(aliveOnly),
    index("pending_onboardings_tenant_idx").on(table.tenantId),
    index("pending_onboardings_telegram_user_idx").on(table.telegramUserId),
  ],
);

export type OnboardingStep = (typeof onboardingStepEnum.enumValues)[number];

export interface PendingOnboarding {
  readonly id: string;
  readonly chatId: string;
  readonly tenantId: string | null;
  readonly step: OnboardingStep;
  readonly language: string;
  readonly telegramUserId: string;
  readonly telegramUsername: string | null;
  readonly invitationToken: string | null;
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}
