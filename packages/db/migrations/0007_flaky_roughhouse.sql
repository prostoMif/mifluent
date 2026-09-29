CREATE TYPE "public"."onboarding_step" AS ENUM('awaiting_input', 'discovering', 'listing', 'choosing_timezone', 'completed');--> statement-breakpoint
CREATE TABLE "pending_onboardings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"tenant_id" uuid,
	"step" "onboarding_step" DEFAULT 'awaiting_input' NOT NULL,
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_onboardings" ADD CONSTRAINT "pending_onboardings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_onboardings_chat_id_unique" ON "pending_onboardings" USING btree ("chat_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "pending_onboardings_tenant_idx" ON "pending_onboardings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pending_onboardings_telegram_user_idx" ON "pending_onboardings" USING btree ("telegram_user_id");