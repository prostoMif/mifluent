ALTER TABLE "event_items" DROP CONSTRAINT "event_items_raw_item_id_raw_items_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_raw_item_id_raw_items_id_fk";
--> statement-breakpoint
ALTER TABLE "event_items" ALTER COLUMN "raw_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "raw_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_title" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "source_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Existing events copy their source while the raw item is still there, so
-- the first retention pass after this migration cannot strip their links.
UPDATE "events" AS e
SET "source_url" = r."url",
    "source_title" = r."title",
    "source_published_at" = r."published_at"
FROM "raw_items" AS r
WHERE r."id" = e."raw_item_id"
  AND r."tenant_id" = e."tenant_id"
  AND e."source_url" IS NULL;
