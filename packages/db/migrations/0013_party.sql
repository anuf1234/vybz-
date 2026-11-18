CREATE TABLE "party" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"genre" text,
	"host_user_id" text,
	"host_key_hash" text NOT NULL,
	"ip_hash" text,
	"phase" text DEFAULT 'LOBBY' NOT NULL,
	"game" text,
	"game_no" integer DEFAULT 0 NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "party_answer" (
	"party_id" text NOT NULL,
	"step" text NOT NULL,
	"player_id" text NOT NULL,
	"value" jsonb NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_answer_party_id_step_player_id_pk" PRIMARY KEY("party_id","step","player_id")
);
--> statement-breakpoint
CREATE TABLE "party_player" (
	"id" text PRIMARY KEY NOT NULL,
	"party_id" text NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"key_hash" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "party" ADD CONSTRAINT "party_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_answer" ADD CONSTRAINT "party_answer_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_answer" ADD CONSTRAINT "party_answer_player_id_party_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."party_player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_player" ADD CONSTRAINT "party_player_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_player" ADD CONSTRAINT "party_player_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_live_code_uq" ON "party" USING btree ("code") WHERE "party"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "party_ip_idx" ON "party" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "party_player_name_uq" ON "party_player" USING btree ("party_id",lower("name"));--> statement-breakpoint
CREATE INDEX "party_player_party_idx" ON "party_player" USING btree ("party_id");