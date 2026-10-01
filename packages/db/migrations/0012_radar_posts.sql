CREATE TABLE "radar_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"language" text NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_posts_status_check" CHECK ("radar_posts"."status" IN ('drafted', 'queued', 'published', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "radar_posts" ADD CONSTRAINT "radar_posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "radar_posts_event_unique" ON "radar_posts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "radar_posts_language_created_idx" ON "radar_posts" USING btree ("language","created_at");