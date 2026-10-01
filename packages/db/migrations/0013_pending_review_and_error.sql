ALTER TABLE "pending_onboardings" ADD COLUMN "reviewed" jsonb;--> statement-breakpoint
ALTER TABLE "pending_onboardings" ADD COLUMN "discovery_error" text;