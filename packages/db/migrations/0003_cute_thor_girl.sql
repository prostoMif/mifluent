CREATE TYPE "public"."rejection_reason" AS ENUM('below_cosine', 'stopword', 'model_rejected');--> statement-breakpoint
CREATE TABLE "rejections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"raw_item_id" uuid,
	"reason" "rejection_reason" NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyst_items" ALTER COLUMN "embedding" SET DATA TYPE vector(384);--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(384);--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "added_text" text;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "removed_text" text;--> statement-breakpoint
ALTER TABLE "rejections" ADD CONSTRAINT "rejections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejections" ADD CONSTRAINT "rejections_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejections" ADD CONSTRAINT "rejections_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rejections_profile_occurred_idx" ON "rejections" USING btree ("profile_id","occurred_at");--> statement-breakpoint
CREATE INDEX "rejections_raw_item_idx" ON "rejections" USING btree ("raw_item_id");