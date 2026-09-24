ALTER TYPE "public"."pipeline_step" ADD VALUE 'discover' BEFORE 'fetch';--> statement-breakpoint
ALTER TYPE "public"."rejection_reason" ADD VALUE 'no_verified_quote';--> statement-breakpoint
CREATE TABLE "telegram_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "digest_cards" ADD COLUMN "kind" text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_cards" ADD COLUMN "more_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "digests" ADD COLUMN "notices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "interpretation" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "rejections" ADD COLUMN "detail" text;--> statement-breakpoint
ALTER TABLE "watch_profiles" ADD COLUMN "delivery" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "watch_targets" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bindings" ADD CONSTRAINT "telegram_bindings_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_bindings_code_hash_unique" ON "telegram_bindings" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "telegram_bindings_tenant_idx" ON "telegram_bindings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "telegram_bindings_expires_idx" ON "telegram_bindings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "chunks_content_hash_idx" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
ALTER TABLE "digest_cards" ADD CONSTRAINT "digest_cards_kind_check" CHECK ("digest_cards"."kind" IN ('event', 'group'));--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_kind_check" CHECK ("raw_items"."kind" IN ('article', 'diff', 'job', 'release'));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_check" CHECK ("tenants"."plan" IN ('free', 'pro', 'team'));