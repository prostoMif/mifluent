ALTER TYPE "public"."user_action_kind" ADD VALUE 'influenced';--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"event_id" uuid,
	"target_id" uuid,
	"text" text NOT NULL,
	"revisit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_target_id_watch_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."watch_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_tenant_created_idx" ON "decisions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_target_created_idx" ON "decisions" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_profile_created_idx" ON "decisions" USING btree ("profile_id","created_at");