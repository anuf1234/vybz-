CREATE TABLE "dj_battle" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"creator_id" text NOT NULL,
	"creator_set_id" text NOT NULL,
	"opponent_id" text,
	"opponent_set_id" text,
	"voting_ends_at" timestamp with time zone,
	"winner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dj_battle_vote" (
	"battle_id" text NOT NULL,
	"voter_id" text NOT NULL,
	"side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dj_battle_vote_battle_id_voter_id_pk" PRIMARY KEY("battle_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "dj_lesson_progress" (
	"user_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"learned_at" timestamp with time zone,
	"watched_at" timestamp with time zone,
	"practiced_at" timestamp with time zone,
	"quiz_score" integer,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dj_lesson_progress_user_id_lesson_id_pk" PRIMARY KEY("user_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "dj_set" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"tracks" jsonb NOT NULL,
	"events" jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"vybz_only" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dj_battle" ADD CONSTRAINT "dj_battle_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_battle" ADD CONSTRAINT "dj_battle_creator_set_id_dj_set_id_fk" FOREIGN KEY ("creator_set_id") REFERENCES "public"."dj_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_battle" ADD CONSTRAINT "dj_battle_opponent_id_user_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_battle" ADD CONSTRAINT "dj_battle_opponent_set_id_dj_set_id_fk" FOREIGN KEY ("opponent_set_id") REFERENCES "public"."dj_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_battle" ADD CONSTRAINT "dj_battle_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_battle_vote" ADD CONSTRAINT "dj_battle_vote_battle_id_dj_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."dj_battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_battle_vote" ADD CONSTRAINT "dj_battle_vote_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_lesson_progress" ADD CONSTRAINT "dj_lesson_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dj_set" ADD CONSTRAINT "dj_set_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dj_battle_status_idx" ON "dj_battle" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dj_set_owner_idx" ON "dj_set" USING btree ("owner_id","created_at");