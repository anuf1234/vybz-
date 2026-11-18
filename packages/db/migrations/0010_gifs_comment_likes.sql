CREATE TABLE "chat_like" (
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_like_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "comment_like" (
	"comment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_like_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "direct_message" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "post_comment" ADD COLUMN "gif" jsonb;--> statement-breakpoint
ALTER TABLE "chat_like" ADD CONSTRAINT "chat_like_message_id_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_like" ADD CONSTRAINT "chat_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_comment_id_post_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_like" ADD CONSTRAINT "comment_like_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;