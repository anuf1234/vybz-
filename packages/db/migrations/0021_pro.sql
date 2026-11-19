CREATE TABLE "subscription" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'APPLE' NOT NULL,
	"product_id" text NOT NULL,
	"original_transaction_id" text NOT NULL,
	"environment" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"will_renew" boolean DEFAULT true NOT NULL,
	"perks_for" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_original_transaction_id_unique" UNIQUE("original_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;