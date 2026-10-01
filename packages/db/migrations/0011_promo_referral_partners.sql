CREATE TABLE "partner_earnings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"paid_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"percent" integer DEFAULT 30 NOT NULL,
	"months" integer DEFAULT 12 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"percent_off" integer DEFAULT 0 NOT NULL,
	"months" integer,
	"trial_days" integer,
	"plan_filter" text,
	"min_months" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_uses" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"partner_id" uuid,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_kind_check" CHECK ("promo_codes"."kind" IN ('community', 'campaign', 'winback', 'selfhost', 'education', 'partner')),
	CONSTRAINT "promo_codes_percent_check" CHECK ("promo_codes"."percent_off" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"referrer_tenant_id" uuid NOT NULL,
	"referred_tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'signed_up' NOT NULL,
	"rewarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_status_check" CHECK ("referrals"."status" IN ('signed_up', 'rewarded'))
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "promo_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "acquired_via" text DEFAULT 'organic' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "acquired_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "winback_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_earnings" ADD CONSTRAINT "partner_earnings_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_tenant_id_tenants_id_fk" FOREIGN KEY ("referrer_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_tenant_id_tenants_id_fk" FOREIGN KEY ("referred_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_earnings_order_unique" ON "partner_earnings" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "partner_earnings_partner_idx" ON "partner_earnings" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_unique" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promo_codes_kind_idx" ON "promo_codes" USING btree ("kind","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_unique" ON "referrals" USING btree ("referred_tenant_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_referral_code_unique" ON "tenants" USING btree ("referral_code");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_acquired_via_check" CHECK ("tenants"."acquired_via" IN ('organic', 'code', 'referral'));--> statement-breakpoint
-- Dated campaigns (−40% on a year, instead of the usual −30%) and the two
-- hand-out codes from the launch plan. Ends are exclusive.
INSERT INTO "promo_codes" ("id", "code", "kind", "percent_off", "min_months", "trial_days", "starts_at", "ends_at") VALUES
	(gen_random_uuid(), 'LAUNCH_EN', 'campaign', 40, 12, NULL, '2026-10-15T00:00:00-07:00', '2026-10-18T00:00:00-07:00'),
	(gen_random_uuid(), 'LAUNCH_RU', 'campaign', 40, 12, NULL, '2026-10-20T00:00:00+03:00', '2026-10-23T00:00:00+03:00'),
	(gen_random_uuid(), 'BLACKFRIDAY', 'campaign', 40, 12, NULL, '2026-11-27T00:00:00+03:00', '2026-12-02T00:00:00+03:00'),
	(gen_random_uuid(), 'NEWYEAR', 'campaign', 40, 12, NULL, '2026-12-26T00:00:00+03:00', '2027-01-01T00:00:00+03:00'),
	(gen_random_uuid(), 'SELFHOST', 'selfhost', 0, NULL, 30, NULL, NULL),
	(gen_random_uuid(), 'EDU', 'education', 50, NULL, NULL, NULL, NULL)
ON CONFLICT ("code") DO NOTHING;
