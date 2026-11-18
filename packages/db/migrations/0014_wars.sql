CREATE TABLE "war" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"title" text NOT NULL,
	"pair_key" text NOT NULL,
	"a" jsonb NOT NULL,
	"b" jsonb NOT NULL,
	"a_ref" text NOT NULL,
	"b_ref" text NOT NULL,
	"creator_id" text NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"winner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "war_vote" (
	"war_id" text NOT NULL,
	"voter_id" text NOT NULL,
	"category" text NOT NULL,
	"side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "war_vote_war_id_voter_id_category_pk" PRIMARY KEY("war_id","voter_id","category")
);
--> statement-breakpoint
ALTER TABLE "war" ADD CONSTRAINT "war_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "war_vote" ADD CONSTRAINT "war_vote_war_id_war_id_fk" FOREIGN KEY ("war_id") REFERENCES "public"."war"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "war_vote" ADD CONSTRAINT "war_vote_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "war_open_pair_uq" ON "war" USING btree ("pair_key") WHERE "war"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "war_status_idx" ON "war" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "war_refs_idx" ON "war" USING btree ("a_ref","b_ref");--> statement-breakpoint
CREATE INDEX "war_vote_created_idx" ON "war_vote" USING btree ("category","created_at");