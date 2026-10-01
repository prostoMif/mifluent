CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_key" text NOT NULL,
	"order_id" uuid,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"months" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"is_early" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider" text DEFAULT 'prodamus' NOT NULL,
	"paid_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_plan_check" CHECK ("payment_orders"."plan" IN ('starter', 'pro', 'team')),
	CONSTRAINT "payment_orders_months_check" CHECK ("payment_orders"."months" IN (1, 3, 6, 12)),
	CONSTRAINT "payment_orders_currency_check" CHECK ("payment_orders"."currency" IN ('RUB', 'USD')),
	CONSTRAINT "payment_orders_status_check" CHECK ("payment_orders"."status" IN ('created', 'paid', 'failed', 'refund_requested', 'refunded'))
);
--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT "tenants_plan_check";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_ends_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_key_unique" ON "billing_events" USING btree ("provider","provider_event_key");--> statement-breakpoint
CREATE INDEX "payment_orders_tenant_idx" ON "payment_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_orders_paid_early_idx" ON "payment_orders" USING btree ("is_early","status");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_check" CHECK ("tenants"."plan" IN ('free', 'starter', 'pro', 'team'));