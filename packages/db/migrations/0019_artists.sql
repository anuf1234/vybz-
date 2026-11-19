CREATE TABLE "artist_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"provider" text,
	"external_id" text,
	"bio" text,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"code" text NOT NULL,
	"proof_url" text NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "war" ADD COLUMN "challenge" jsonb;--> statement-breakpoint
ALTER TABLE "artist_profile" ADD CONSTRAINT "artist_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_profile" ADD CONSTRAINT "artist_profile_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artist_profile_verified_uq" ON "artist_profile" USING btree ("name_key") WHERE "artist_profile"."status" = 'VERIFIED';--> statement-breakpoint
CREATE INDEX "artist_profile_status_idx" ON "artist_profile" USING btree ("status");