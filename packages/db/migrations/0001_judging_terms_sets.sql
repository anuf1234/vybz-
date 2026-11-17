CREATE TABLE "ai_verdict" (
	"round_id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"winner_participant_id" text NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "submission_round_participant_uq";--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "proposed_by_id" text;--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "previous_rules" jsonb;--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "counter_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "battle_round" ADD COLUMN "ai_winner_participant_id" text;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_verdict" ADD CONSTRAINT "ai_verdict_round_id_battle_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."battle_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_verdict" ADD CONSTRAINT "ai_verdict_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_verdict" ADD CONSTRAINT "ai_verdict_winner_participant_id_battle_participant_id_fk" FOREIGN KEY ("winner_participant_id") REFERENCES "public"."battle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle" ADD CONSTRAINT "battle_proposed_by_id_user_id_fk" FOREIGN KEY ("proposed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_round_participant_position_uq" ON "submission" USING btree ("round_id","participant_id","position");