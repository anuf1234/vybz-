CREATE TABLE "battle_access" (
	"battle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_access_battle_id_user_id_pk" PRIMARY KEY("battle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "battle_invite" (
	"battle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_invite_battle_id_user_id_pk" PRIMARY KEY("battle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "battle_presence" (
	"battle_id" text NOT NULL,
	"viewer_key" text NOT NULL,
	"user_id" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "battle_presence_battle_id_viewer_key_pk" PRIMARY KEY("battle_id","viewer_key")
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_action" (
	"id" text PRIMARY KEY NOT NULL,
	"moderator_id" text NOT NULL,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"battle_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_token" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"user_id" text,
	"viewer_key" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"battle_id" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"handled_by_id" text,
	"handled_at" timestamp with time zone,
	"action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track_heart" (
	"submission_id" text NOT NULL,
	"voter_id" text NOT NULL,
	"battle_id" text NOT NULL,
	"round_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_heart_submission_id_voter_id_pk" PRIMARY KEY("submission_id","voter_id")
);
--> statement-breakpoint
ALTER TABLE "battle_participant" DROP CONSTRAINT "participant_side_check";--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "visibility" text DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "battle" ADD COLUMN "daily_date" text;--> statement-breakpoint
ALTER TABLE "battle_round" ADD COLUMN "contender_ids" text[];--> statement-breakpoint
ALTER TABLE "battle_access" ADD CONSTRAINT "battle_access_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_access" ADD CONSTRAINT "battle_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_invite" ADD CONSTRAINT "battle_invite_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_invite" ADD CONSTRAINT "battle_invite_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_presence" ADD CONSTRAINT "battle_presence_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_presence" ADD CONSTRAINT "battle_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_hidden_by_id_user_id_fk" FOREIGN KEY ("hidden_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_action" ADD CONSTRAINT "moderation_action_moderator_id_user_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_token" ADD CONSTRAINT "push_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_handled_by_id_user_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_heart" ADD CONSTRAINT "track_heart_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_heart" ADD CONSTRAINT "track_heart_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_heart" ADD CONSTRAINT "track_heart_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_heart" ADD CONSTRAINT "track_heart_round_id_battle_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."battle_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presence_seen_idx" ON "battle_presence" USING btree ("battle_id","last_seen");--> statement-breakpoint
CREATE INDEX "chat_battle_idx" ON "chat_message" USING btree ("battle_id","id");--> statement-breakpoint
CREATE INDEX "chat_user_idx" ON "chat_message" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "push_token_user_idx" ON "push_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reaction_battle_idx" ON "reaction" USING btree ("battle_id","created_at");--> statement-breakpoint
CREATE INDEX "reaction_viewer_idx" ON "reaction" USING btree ("viewer_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_once_uq" ON "report" USING btree ("reporter_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "heart_battle_idx" ON "track_heart" USING btree ("battle_id");--> statement-breakpoint
ALTER TABLE "battle" ADD CONSTRAINT "battle_daily_date_unique" UNIQUE("daily_date");--> statement-breakpoint
ALTER TABLE "battle_participant" ADD CONSTRAINT "participant_side_check" CHECK ("battle_participant"."side" between 0 and 7);