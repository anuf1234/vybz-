CREATE TABLE "rated_battle" (
	"battle_id" text PRIMARY KEY NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"creator_id" text NOT NULL,
	"entries" jsonb NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"alive" jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'LIVE' NOT NULL,
	"round_ends_at" timestamp with time zone NOT NULL,
	"champion" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_vote" (
	"tournament_id" text NOT NULL,
	"user_id" text NOT NULL,
	"round" integer NOT NULL,
	"match" integer NOT NULL,
	"entry" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_vote_tournament_id_user_id_round_match_pk" PRIMARY KEY("tournament_id","user_id","round","match")
);
--> statement-breakpoint
CREATE TABLE "user_rating" (
	"user_id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"rating" integer DEFAULT 1000 NOT NULL,
	"peak" integer DEFAULT 1000 NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "ranked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rated_battle" ADD CONSTRAINT "rated_battle_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament" ADD CONSTRAINT "tournament_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_vote" ADD CONSTRAINT "tournament_vote_tournament_id_tournament_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournament"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_vote" ADD CONSTRAINT "tournament_vote_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rating" ADD CONSTRAINT "user_rating_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_status_idx" ON "tournament" USING btree ("status","round_ends_at");--> statement-breakpoint
CREATE INDEX "user_rating_board_idx" ON "user_rating" USING btree ("season","rating");