CREATE TABLE "drop_award" (
	"award" text NOT NULL,
	"period" text NOT NULL,
	"release_id" text NOT NULL,
	"stats" jsonb NOT NULL,
	"post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drop_award_award_period_pk" PRIMARY KEY("award","period")
);
--> statement-breakpoint
ALTER TABLE "drop_award" ADD CONSTRAINT "drop_award_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_award" ADD CONSTRAINT "drop_award_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drop_award_release_idx" ON "drop_award" USING btree ("release_id");