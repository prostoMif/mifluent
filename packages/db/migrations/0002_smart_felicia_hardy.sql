ALTER TYPE "public"."user_action_kind" ADD VALUE 'not_following_target';--> statement-breakpoint
ALTER TYPE "public"."user_action_kind" ADD VALUE 'not_important';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'json';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'diff';--> statement-breakpoint
CREATE TABLE "event_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "kind" text DEFAULT 'article' NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "page_version_id" uuid;--> statement-breakpoint
ALTER TABLE "watch_profiles" ADD COLUMN "facts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "added_text" text;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "removed_text" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "target_id" uuid;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_items_event_raw_item_unique" ON "event_items" USING btree ("event_id","raw_item_id");--> statement-breakpoint
CREATE INDEX "event_items_tenant_idx" ON "event_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "event_items_raw_item_idx" ON "event_items" USING btree ("raw_item_id");--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_page_version_id_page_versions_id_fk" FOREIGN KEY ("page_version_id") REFERENCES "public"."page_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_target_id_watch_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."watch_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_items_page_version_idx" ON "raw_items" USING btree ("page_version_id");--> statement-breakpoint
CREATE INDEX "sources_target_idx" ON "sources" USING btree ("target_id");