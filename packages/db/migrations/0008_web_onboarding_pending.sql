-- Rename existing pending_onboardings to pending_telegram_onboardings
ALTER TABLE "pending_onboardings" RENAME TO "pending_telegram_onboardings";
ALTER INDEX "pending_onboardings_chat_id_unique" RENAME TO "pending_telegram_onboardings_chat_id_unique";
ALTER INDEX "pending_onboardings_tenant_idx" RENAME TO "pending_telegram_onboardings_tenant_idx";
ALTER INDEX "pending_onboardings_telegram_user_idx" RENAME TO "pending_telegram_onboardings_telegram_user_idx";
ALTER TYPE "onboarding_step" RENAME TO "telegram_onboarding_step";

-- Create new pending_onboardings for web onboarding
CREATE TABLE "pending_onboardings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"discovery_run_id" text,
	"result" jsonb,
	"input" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"timezone" text,
	"channel" text NOT NULL,
	"email_hash" text,
	"ip_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "pending_onboardings_ip_hash_idx" ON "pending_onboardings" USING btree ("ip_hash");
CREATE INDEX "pending_onboardings_expires_at_idx" ON "pending_onboardings" USING btree ("expires_at");
CREATE INDEX "pending_onboardings_consumed_at_idx" ON "pending_onboardings" USING btree ("consumed_at");
