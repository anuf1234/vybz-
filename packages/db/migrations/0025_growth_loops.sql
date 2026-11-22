CREATE TABLE "league_member" (
	"user_id" text NOT NULL,
	"week" text NOT NULL,
	"tier" integer NOT NULL,
	"group_id" text NOT NULL,
	"final_rank" integer,
	"final_xp" integer,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_member_user_id_week_pk" PRIMARY KEY("user_id","week")
);
--> statement-breakpoint
CREATE TABLE "season_badge" (
	"user_id" text NOT NULL,
	"season" text NOT NULL,
	"division" text NOT NULL,
	"peak" integer NOT NULL,
	"games" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_badge_user_id_season_pk" PRIMARY KEY("user_id","season")
);
--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "bot_fallback" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "pace" text DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "party" ADD COLUMN "paused_left_ms" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "league_member" ADD CONSTRAINT "league_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_badge" ADD CONSTRAINT "season_badge_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "league_group_idx" ON "league_member" USING btree ("week","group_id");--> statement-breakpoint
ALTER TABLE "battle" ADD CONSTRAINT "battle_join_code_unique" UNIQUE("join_code");