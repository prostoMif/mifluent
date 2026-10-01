ALTER TABLE "pending_onboardings" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "pending_onboardings" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
CREATE INDEX "pending_onboardings_telegram_user_idx" ON "pending_onboardings" USING btree ("telegram_user_id");