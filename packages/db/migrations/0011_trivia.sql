CREATE TABLE "trivia_flag" (
	"question_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trivia_flag_question_id_user_id_pk" PRIMARY KEY("question_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "trivia_play" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"user_id" text NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"served_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"correct" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trivia_question" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"genre" text,
	"difficulty" integer DEFAULT 2 NOT NULL,
	"prompt" text NOT NULL,
	"choices" text[] NOT NULL,
	"answer_index" integer NOT NULL,
	"explanation" text,
	"track_id" text,
	"source" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"dedupe_key" text,
	"times_asked" integer DEFAULT 0 NOT NULL,
	"times_correct" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trivia_question_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "trivia_question_answer_ck" CHECK ("trivia_question"."answer_index" >= 0 and "trivia_question"."answer_index" < cardinality("trivia_question"."choices"))
);
--> statement-breakpoint
CREATE TABLE "trivia_set" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"day" text,
	"category" text,
	"genre" text,
	"question_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trivia_flag" ADD CONSTRAINT "trivia_flag_question_id_trivia_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."trivia_question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_flag" ADD CONSTRAINT "trivia_flag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_play" ADD CONSTRAINT "trivia_play_set_id_trivia_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."trivia_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_play" ADD CONSTRAINT "trivia_play_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_question" ADD CONSTRAINT "trivia_question_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_question" ADD CONSTRAINT "trivia_question_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_question" ADD CONSTRAINT "trivia_question_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trivia_play_once_uq" ON "trivia_play" USING btree ("set_id","user_id");--> statement-breakpoint
CREATE INDEX "trivia_play_user_idx" ON "trivia_play" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "trivia_question_pick_idx" ON "trivia_question" USING btree ("status","category","genre");--> statement-breakpoint
CREATE UNIQUE INDEX "trivia_set_daily_uq" ON "trivia_set" USING btree ("day") WHERE "trivia_set"."mode" = 'DAILY';