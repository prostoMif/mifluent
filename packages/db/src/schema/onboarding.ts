/**
 * Pending onboarding dialogues.
 *
 * Two separate tables:
 * - `pending_telegram_onboardings` — Telegram bot onboarding (chat-keyed)
 * - `pending_onboardings` — Web onboarding (cookie-keyed, anonymous discovery)
 */

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aliveOnly, id, softDelete, timestamps } from "./common.js";
import { tenants } from "./tenancy.js";

/** Telegram onboarding steps. */
export const telegramOnboardingStepEnum = pgEnum("telegram_onboarding_step", [
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

/** Telegram onboarding — keyed by chat ID. */
export const pendingTelegramOnboardings = pgTable(
  "pending_telegram_onboardings",
  {
    id: id(),
    /** The Telegram chat this onboarding belongs to. */
    chatId: text("chat_id").notNull(),
    /** The tenant this onboarding will create or join. Null until known. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** Current step of the onboarding flow. */
    step: telegramOnboardingStepEnum("step").notNull().default("awaiting_input"),
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
    uniqueIndex("pending_telegram_onboardings_chat_id_unique").on(table.chatId).where(aliveOnly),
    index("pending_telegram_onboardings_tenant_idx").on(table.tenantId),
    index("pending_telegram_onboardings_telegram_user_idx").on(table.telegramUserId),
  ],
);

export type TelegramOnboardingStep = (typeof telegramOnboardingStepEnum.enumValues)[number];

export interface PendingTelegramOnboarding {
  readonly id: string;
  readonly chatId: string;
  readonly tenantId: string | null;
  readonly step: TelegramOnboardingStep;
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

/** Web onboarding channels. */
export const onboardingChannelEnum = pgEnum("onboarding_channel", [
  "email",
  "telegram",
  "waitlist",
]);

/** Web onboarding — keyed by cookie, for anonymous discovery. */
export const pendingOnboardings = pgTable(
  "pending_onboardings",
  {
    id: id(),
    /** Discovery job ID while discovery is running. */
    discoveryRunId: text("discovery_run_id"),
    /** Discovery result (JSON) once completed. */
    result: jsonb("result"),
    /**
     * What the person confirmed on the review screen: the profile exactly as
     * it will be created, edits included. Null until they confirm; the raw
     * discovery result is used then.
     */
    reviewed: jsonb("reviewed"),
    /** Why discovery failed, in words for the person; null while it runs or once it succeeded. */
    discoveryError: text("discovery_error"),
    /** Original input: URL or business description. */
    input: text("input").notNull(),
    /** Language of the digest (en/ru). */
    language: text("language").notNull().default("en"),
    /** Timezone from browser. */
    timezone: text("timezone"),
    /** Delivery channel chosen by the user. */
    channel: onboardingChannelEnum("channel").notNull(),
    /** Hashed email for deduplication (when channel=email). */
    emailHash: text("email_hash"),
    /** Hashed IP for rate limiting. */
    ipHash: text("ip_hash").notNull(),
    /** When this pending onboarding expires (24h). */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** When this pending onboarding was consumed (magic link clicked). */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("pending_onboardings_ip_hash_idx").on(table.ipHash),
    index("pending_onboardings_expires_at_idx").on(table.expiresAt),
    index("pending_onboardings_consumed_at_idx").on(table.consumedAt),
  ],
);

export type OnboardingChannel = (typeof onboardingChannelEnum.enumValues)[number];

export interface PendingOnboarding {
  readonly id: string;
  readonly discoveryRunId: string | null;
  readonly result: DiscoveryResult | null;
  readonly reviewed: unknown;
  readonly discoveryError: string | null;
  readonly input: string;
  readonly language: string;
  readonly timezone: string | null;
  readonly channel: OnboardingChannel;
  readonly emailHash: string | null;
  readonly ipHash: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly consumedAt: Date | null;
}

/** Discovery result stored in pending_onboardings.result (JSONB). */
export interface DiscoveryResult {
  readonly business: {
    readonly name: string;
    readonly description: string;
    readonly niche: string;
    readonly monetization: "free" | "trial" | "subscription" | "one_time" | "unknown";
    readonly platforms: string[];
    readonly countries: string[];
    readonly country: string | undefined;
    readonly extraCountries: string[];
    readonly homeCountry: string | undefined;
    readonly region: string | undefined;
    readonly customerType: string;
    readonly language: "en" | "ru";
  };
  readonly targets: Array<{
    readonly kind: "competitor" | "platform" | "condition";
    readonly name: string;
    readonly websiteUrl: string | null;
    readonly reason: string;
    readonly surfaces: Array<{
      readonly type: "feed" | "diff" | "json" | "query";
      readonly url: string;
      readonly label: string;
      readonly pollIntervalMinutes: number;
      readonly verified: boolean;
    }>;
    readonly newsQuery: string | undefined;
  }>;
  readonly conditions: Array<{
    readonly name: string;
    readonly reason: string;
    readonly surfaces: Array<{
      readonly type: "feed" | "diff" | "json" | "query";
      readonly url: string;
      readonly label: string;
      readonly pollIntervalMinutes: number;
      readonly verified: boolean;
    }>;
    readonly newsQuery: string | undefined;
  }>;
  readonly needsDescription: boolean;
}
