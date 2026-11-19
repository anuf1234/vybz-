CREATE TABLE "activity_day" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_day_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "artist_follow" (
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"artwork_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_follow_user_id_provider_external_id_pk" PRIMARY KEY("user_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "drop_run" (
	"day" text PRIMARY KEY NOT NULL,
	"post_id" text,
	"found" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"artist_name" text NOT NULL,
	"artwork_url" text,
	"external_url" text,
	"release_date" text,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"track_count" integer,
	"source" text NOT NULL,
	"status" text DEFAULT 'LIVE' NOT NULL,
	"drop_day" text NOT NULL,
	"rank" integer DEFAULT 1000 NOT NULL,
	"submitted_by_id" text,
	"note" text,
	"war_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_fire" (
	"release_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_fire_release_id_user_id_pk" PRIMARY KEY("release_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "activity_day" ADD CONSTRAINT "activity_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_follow" ADD CONSTRAINT "artist_follow_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_run" ADD CONSTRAINT "drop_run_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_submitted_by_id_user_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_war_id_war_id_fk" FOREIGN KEY ("war_id") REFERENCES "public"."war"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_fire" ADD CONSTRAINT "release_fire_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_fire" ADD CONSTRAINT "release_fire_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artist_follow_artist_idx" ON "artist_follow" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_provider_uq" ON "release" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "release_drop_idx" ON "release" USING btree ("status","drop_day","rank");--> statement-breakpoint
CREATE INDEX "release_artist_idx" ON "release" USING btree ("artist_name");--> statement-breakpoint
CREATE INDEX "release_fire_user_idx" ON "release_fire" USING btree ("user_id","created_at");