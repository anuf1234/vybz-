CREATE TABLE "music_link" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'APPLE_MUSIC' NOT NULL,
	"token_enc" text NOT NULL,
	"last_seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "play_event" (
	"user_id" text NOT NULL,
	"release_id" text NOT NULL,
	"day" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "play_event_user_id_release_id_day_pk" PRIMARY KEY("user_id","release_id","day")
);
--> statement-breakpoint
ALTER TABLE "music_link" ADD CONSTRAINT "music_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_event" ADD CONSTRAINT "play_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_event" ADD CONSTRAINT "play_event_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "play_event_created_idx" ON "play_event" USING btree ("created_at");