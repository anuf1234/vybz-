ALTER TABLE "battle" ADD COLUMN "quick_match" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user" SET "is_system" = true WHERE "handle" IN ('vybz_daily', 'vybz_bot');
