CREATE TYPE "public"."onboarding_channel" AS ENUM('email', 'telegram', 'waitlist');--> statement-breakpoint
CREATE TYPE "public"."telegram_onboarding_step" AS ENUM('awaiting_input', 'discovering', 'listing', 'choosing_timezone', 'completed');--> statement-breakpoint
ALTER TYPE "public"."watch_target_kind" ADD VALUE 'self';--> statement-breakpoint
CREATE TABLE "pending_onboardings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"discovery_run_id" text,
	"result" jsonb,
	"input" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"timezone" text,
	"channel" "onboarding_channel" NOT NULL,
	"email_hash" text,
	"ip_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_telegram_onboardings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"tenant_id" uuid,
	"step" "telegram_onboarding_step" DEFAULT 'awaiting_input' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"telegram_user_id" text NOT NULL,
	"telegram_username" text,
	"invitation_token" text,
	"discovery_job_id" text,
	"discovery_result" text,
	"selected_target_ids" text,
	"business_description" text,
	"website_url" text,
	"timezone" text,
	"profile_name" text,
	"error_message" text,
	"progress_update_count" integer DEFAULT 0 NOT NULL,
	"last_progress_update_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pending_telegram_onboardings" ADD CONSTRAINT "pending_telegram_onboardings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_onboardings_ip_hash_idx" ON "pending_onboardings" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "pending_onboardings_expires_at_idx" ON "pending_onboardings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_onboardings_consumed_at_idx" ON "pending_onboardings" USING btree ("consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_telegram_onboardings_chat_id_unique" ON "pending_telegram_onboardings" USING btree ("chat_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "pending_telegram_onboardings_tenant_idx" ON "pending_telegram_onboardings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pending_telegram_onboardings_telegram_user_idx" ON "pending_telegram_onboardings" USING btree ("telegram_user_id");