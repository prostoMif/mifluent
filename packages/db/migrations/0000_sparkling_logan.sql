CREATE TYPE "public"."card_block_kind" AS ENUM('fact', 'implication', 'analyst_opinion', 'model_interpretation');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('telegram', 'email', 'web_only');--> statement-breakpoint
CREATE TYPE "public"."digest_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."model_tier" AS ENUM('cheap', 'deep');--> statement-breakpoint
CREATE TYPE "public"."pipeline_step" AS ENUM('fetch', 'embed', 'classify', 'extract', 'verify', 'match', 'compose');--> statement-breakpoint
CREATE TYPE "public"."user_action_kind" AS ENUM('saved', 'dismissed', 'copied', 'opened_source', 'marked_irrelevant', 'card_viewed');--> statement-breakpoint
CREATE TYPE "public"."watch_target_kind" AS ENUM('competitor', 'platform', 'condition');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'reddit', 'hacker_news', 'google_news', 'email_inbox', 'page_diff');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'paused', 'broken');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "analyst_feeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analyst_id" uuid NOT NULL,
	"feed_url" text NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyst_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analyst_id" uuid NOT NULL,
	"feed_id" uuid,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analyst_opinions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"analyst_item_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"homepage_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"review_notes" text,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"kind" "card_block_kind" NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"source_url" text,
	"quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"digest_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"headline" text NOT NULL,
	"source_url" text,
	"age_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "digest_status" DEFAULT 'pending' NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"delivered_at" timestamp with time zone,
	"failure_reason" text,
	"sources_checked" integer DEFAULT 0 NOT NULL,
	"items_considered" integer DEFAULT 0 NOT NULL,
	"near_misses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version_id" uuid NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"target_id" uuid,
	"relevance_score" real NOT NULL,
	"summary" text NOT NULL,
	"implication" text,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"quote" text NOT NULL,
	"quote_start_offset" integer NOT NULL,
	"quote_end_offset" integer NOT NULL,
	"verified" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"raw_item_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text,
	"url" text,
	"title" text,
	"author" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tier" "model_tier" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text,
	"encrypted_key" text NOT NULL,
	"encryption_nonce" text NOT NULL,
	"encryption_key_version" text DEFAULT 'v1' NOT NULL,
	"last_four_chars" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spend_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"daily_limit_usd" text DEFAULT '1.00' NOT NULL,
	"last_tripped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_costs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step" "pipeline_step" NOT NULL,
	"model" text,
	"provider" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text,
	"kind" "user_action_kind" NOT NULL,
	"card_id" uuid,
	"event_id" uuid,
	"surface" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stopwords" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"term" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_profile_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"business_description" text,
	"website_url" text,
	"relevance_threshold" real DEFAULT 0.5 NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "watch_target_kind" NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"extracted_text" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_errors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"http_status" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"label" text NOT NULL,
	"locator" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"poll_interval_minutes" integer DEFAULT 60 NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"invited_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analyst_feeds" ADD CONSTRAINT "analyst_feeds_analyst_id_analysts_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."analysts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_items" ADD CONSTRAINT "analyst_items_analyst_id_analysts_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."analysts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_items" ADD CONSTRAINT "analyst_items_feed_id_analyst_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."analyst_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_opinions" ADD CONSTRAINT "analyst_opinions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_opinions" ADD CONSTRAINT "analyst_opinions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_opinions" ADD CONSTRAINT "analyst_opinions_analyst_item_id_analyst_items_id_fk" FOREIGN KEY ("analyst_item_id") REFERENCES "public"."analyst_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_blocks" ADD CONSTRAINT "card_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_blocks" ADD CONSTRAINT "card_blocks_card_id_digest_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."digest_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_cards" ADD CONSTRAINT "digest_cards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_cards" ADD CONSTRAINT "digest_cards_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_cards" ADD CONSTRAINT "digest_cards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_profile_version_id_watch_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."watch_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_profile_version_id_watch_profile_versions_id_fk" FOREIGN KEY ("profile_version_id") REFERENCES "public"."watch_profile_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_target_id_watch_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."watch_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_raw_item_id_raw_items_id_fk" FOREIGN KEY ("raw_item_id") REFERENCES "public"."raw_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_settings" ADD CONSTRAINT "model_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_limits" ADD CONSTRAINT "spend_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_costs" ADD CONSTRAINT "operation_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_card_id_digest_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."digest_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stopwords" ADD CONSTRAINT "stopwords_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stopwords" ADD CONSTRAINT "stopwords_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_profile_versions" ADD CONSTRAINT "watch_profile_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_profile_versions" ADD CONSTRAINT "watch_profile_versions_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_profiles" ADD CONSTRAINT "watch_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_targets" ADD CONSTRAINT "watch_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_targets" ADD CONSTRAINT "watch_targets_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_errors" ADD CONSTRAINT "source_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_errors" ADD CONSTRAINT "source_errors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_profile_id_watch_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."watch_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analyst_feeds_url_unique" ON "analyst_feeds" USING btree ("feed_url");--> statement-breakpoint
CREATE UNIQUE INDEX "analyst_items_url_unique" ON "analyst_items" USING btree ("url");--> statement-breakpoint
CREATE INDEX "analyst_items_analyst_published_idx" ON "analyst_items" USING btree ("analyst_id","published_at");--> statement-breakpoint
CREATE INDEX "analyst_items_vector_idx" ON "analyst_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "analyst_opinions_event_item_unique" ON "analyst_opinions" USING btree ("event_id","analyst_item_id");--> statement-breakpoint
CREATE INDEX "analyst_opinions_tenant_idx" ON "analyst_opinions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysts_slug_unique" ON "analysts" USING btree ("slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "card_blocks_card_position_unique" ON "card_blocks" USING btree ("card_id","position");--> statement-breakpoint
CREATE INDEX "card_blocks_kind_idx" ON "card_blocks" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_cards_digest_position_unique" ON "digest_cards" USING btree ("digest_id","position");--> statement-breakpoint
CREATE INDEX "digest_cards_event_idx" ON "digest_cards" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "digests_profile_period_idx" ON "digests" USING btree ("profile_id","period_end");--> statement-breakpoint
CREATE INDEX "digests_tenant_idx" ON "digests" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digests_profile_period_channel_unique" ON "digests" USING btree ("profile_id","period_start","period_end","channel");--> statement-breakpoint
CREATE INDEX "events_profile_created_idx" ON "events" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "events_tenant_created_idx" ON "events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "events_target_idx" ON "events" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "events_raw_item_idx" ON "events" USING btree ("raw_item_id");--> statement-breakpoint
CREATE INDEX "facts_event_idx" ON "facts" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_item_ordinal_unique" ON "chunks" USING btree ("raw_item_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_tenant_idx" ON "chunks" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_chunk_model_unique" ON "embeddings" USING btree ("chunk_id","model");--> statement-breakpoint
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embeddings_tenant_idx" ON "embeddings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_items_tenant_hash_unique" ON "raw_items" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX "raw_items_source_fetched_idx" ON "raw_items" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_items_tenant_fetched_idx" ON "raw_items" USING btree ("tenant_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "model_settings_tenant_tier_unique" ON "model_settings" USING btree ("tenant_id","tier");--> statement-breakpoint
CREATE INDEX "provider_keys_tenant_idx" ON "provider_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_keys_tenant_provider_unique" ON "provider_keys" USING btree ("tenant_id","provider") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "spend_limits_tenant_unique" ON "spend_limits" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "operation_costs_tenant_occurred_idx" ON "operation_costs" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "operation_costs_step_idx" ON "operation_costs" USING btree ("step");--> statement-breakpoint
CREATE INDEX "user_actions_tenant_occurred_idx" ON "user_actions" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "user_actions_event_idx" ON "user_actions" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "user_actions_kind_idx" ON "user_actions" USING btree ("kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stopwords_profile_term_unique" ON "stopwords" USING btree ("profile_id","term") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "topics_profile_idx" ON "topics" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_profile_label_unique" ON "topics" USING btree ("profile_id","label") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "watch_profile_versions_profile_version_unique" ON "watch_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "watch_profile_versions_tenant_idx" ON "watch_profile_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "watch_profiles_tenant_idx" ON "watch_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_profiles_tenant_name_unique" ON "watch_profiles" USING btree ("tenant_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "watch_targets_profile_idx" ON "watch_targets" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "watch_targets_kind_idx" ON "watch_targets" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_targets_profile_name_unique" ON "watch_targets" USING btree ("profile_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "page_versions_source_fetched_idx" ON "page_versions" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_versions_source_hash_unique" ON "page_versions" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "source_errors_source_occurred_idx" ON "source_errors" USING btree ("source_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sources_profile_idx" ON "sources" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "sources_tenant_idx" ON "sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sources_due_idx" ON "sources" USING btree ("status","last_polled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_profile_kind_locator_unique" ON "sources" USING btree ("profile_id","kind","locator") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_unique" ON "memberships" USING btree ("tenant_id","user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tenants_deleted_at_idx" ON "tenants" USING btree ("deleted_at");