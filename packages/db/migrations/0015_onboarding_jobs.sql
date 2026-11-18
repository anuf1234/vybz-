CREATE TABLE "job_run" (
	"key" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "favorite_genres" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "onboarding_skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- People who joined before onboarding existed don't get sent through it.
INSERT INTO "user_progress" ("user_id", "onboarded_at") SELECT "id", now() FROM "user" ON CONFLICT ("user_id") DO UPDATE SET "onboarded_at" = now();
