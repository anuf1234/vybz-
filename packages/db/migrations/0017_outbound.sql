CREATE TABLE "link_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_click" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"viewer_key" text,
	"service" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_click" ADD CONSTRAINT "outbound_click_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_created_idx" ON "outbound_click" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outbound_service_idx" ON "outbound_click" USING btree ("service","created_at");