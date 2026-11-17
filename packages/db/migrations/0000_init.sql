CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battle" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'SONG' NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"theme" text,
	"rules" jsonb NOT NULL,
	"round_count" integer NOT NULL,
	"creator_id" text NOT NULL,
	"invited_user_id" text,
	"accept_deadline" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"winner_participant_id" text,
	"rematch_of_id" text,
	"next_deadline_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battle_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"side" integer NOT NULL,
	"rounds_won" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_side_check" CHECK ("battle_participant"."side" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE "battle_round" (
	"id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"index" integer NOT NULL,
	"status" text NOT NULL,
	"sudden_death" boolean DEFAULT false NOT NULL,
	"submissions_close_at" timestamp with time zone,
	"voting_opens_at" timestamp with time zone,
	"voting_closes_at" timestamp with time zone,
	"extensions" integer DEFAULT 0 NOT NULL,
	"winner_participant_id" text,
	"forfeit_participant_ids" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listen_proof" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"user_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"tier" text NOT NULL,
	"played_ms" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"round_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"track_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "track" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist_name" text NOT NULL,
	"album_name" text,
	"isrc" text,
	"release_year" integer,
	"duration_ms" integer,
	"artwork_url" text,
	"explicit" boolean DEFAULT false NOT NULL,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_isrc_unique" UNIQUE("isrc")
);
--> statement-breakpoint
CREATE TABLE "track_provider_ref" (
	"id" text PRIMARY KEY NOT NULL,
	"track_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"preview_url" text,
	"embeddable" boolean,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"handle" text NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_handle_unique" UNIQUE("handle"),
	CONSTRAINT "user_handle_format" CHECK ("user"."handle" ~ '^[a-z0-9_]{3,20}$')
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vote" (
	"id" text PRIMARY KEY NOT NULL,
	"battle_id" text NOT NULL,
	"round_id" text NOT NULL,
	"voter_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'COUNTED' NOT NULL,
	"tier" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle" ADD CONSTRAINT "battle_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle" ADD CONSTRAINT "battle_invited_user_id_user_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participant" ADD CONSTRAINT "battle_participant_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_participant" ADD CONSTRAINT "battle_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_round" ADD CONSTRAINT "battle_round_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_proof" ADD CONSTRAINT "listen_proof_round_id_battle_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."battle_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_proof" ADD CONSTRAINT "listen_proof_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_proof" ADD CONSTRAINT "listen_proof_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_round_id_battle_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."battle_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_participant_id_battle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."battle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_provider_ref" ADD CONSTRAINT "track_provider_ref_track_id_track_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."track"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_battle_id_battle_id_fk" FOREIGN KEY ("battle_id") REFERENCES "public"."battle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_round_id_battle_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."battle_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_voter_id_user_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote" ADD CONSTRAINT "vote_participant_id_battle_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."battle_participant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_uq" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "battle_status_idx" ON "battle" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "battle_deadline_idx" ON "battle" USING btree ("next_deadline_at");--> statement-breakpoint
CREATE INDEX "battle_creator_idx" ON "battle" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "battle_invited_idx" ON "battle" USING btree ("invited_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_battle_user_uq" ON "battle_participant" USING btree ("battle_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_battle_side_uq" ON "battle_participant" USING btree ("battle_id","side");--> statement-breakpoint
CREATE INDEX "participant_user_idx" ON "battle_participant" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_battle_index_uq" ON "battle_round" USING btree ("battle_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "listen_round_user_submission_uq" ON "listen_proof" USING btree ("round_id","user_id","submission_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_round_participant_uq" ON "submission" USING btree ("round_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_battle_track_uq" ON "submission" USING btree ("battle_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "track_ref_provider_uq" ON "track_provider_ref" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "track_ref_track_idx" ON "track_provider_ref" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "vote_round_voter_uq" ON "vote" USING btree ("round_id","voter_id");--> statement-breakpoint
CREATE INDEX "vote_battle_idx" ON "vote" USING btree ("battle_id");