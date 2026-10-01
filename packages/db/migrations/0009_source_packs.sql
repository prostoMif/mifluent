CREATE TABLE "pack_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pack_key" text NOT NULL,
	"source_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_packs" (
	"key" text PRIMARY KEY NOT NULL,
	"definition" jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "pack_key" text;--> statement-breakpoint
ALTER TABLE "pack_sources" ADD CONSTRAINT "pack_sources_pack_key_source_packs_key_fk" FOREIGN KEY ("pack_key") REFERENCES "public"."source_packs"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_sources" ADD CONSTRAINT "pack_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_sources_pack_source_unique" ON "pack_sources" USING btree ("pack_key","source_id");--> statement-breakpoint
CREATE INDEX "pack_sources_source_idx" ON "pack_sources" USING btree ("source_id");