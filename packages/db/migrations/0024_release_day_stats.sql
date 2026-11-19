CREATE TABLE "release_day_stats" (
	"day" text NOT NULL,
	"release_id" text NOT NULL,
	"fires" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"matchups" integer DEFAULT 0 NOT NULL,
	"plays" integer DEFAULT 0 NOT NULL,
	"listens" integer DEFAULT 0 NOT NULL,
	"listens_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"heat" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_day_stats_day_release_id_pk" PRIMARY KEY("day","release_id")
);
--> statement-breakpoint
ALTER TABLE "release_day_stats" ADD CONSTRAINT "release_day_stats_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_day_stats_release_idx" ON "release_day_stats" USING btree ("release_id");