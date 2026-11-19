CREATE TABLE "chart_week" (
	"week" text PRIMARY KEY NOT NULL,
	"rows" jsonb NOT NULL,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_duel" (
	"user_id" text NOT NULL,
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"winner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_duel_user_id_a_id_b_id_pk" PRIMARY KEY("user_id","a_id","b_id")
);
--> statement-breakpoint
ALTER TABLE "chart_week" ADD CONSTRAINT "chart_week_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_duel" ADD CONSTRAINT "release_duel_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_duel" ADD CONSTRAINT "release_duel_a_id_release_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_duel" ADD CONSTRAINT "release_duel_b_id_release_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_duel" ADD CONSTRAINT "release_duel_winner_id_release_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_duel_a_idx" ON "release_duel" USING btree ("a_id");--> statement-breakpoint
CREATE INDEX "release_duel_b_idx" ON "release_duel" USING btree ("b_id");--> statement-breakpoint
CREATE INDEX "release_duel_created_idx" ON "release_duel" USING btree ("created_at");