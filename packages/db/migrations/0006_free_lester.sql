ALTER TABLE "user" ADD COLUMN "telegram_user_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_telegram_user_id_unique" UNIQUE("telegram_user_id");