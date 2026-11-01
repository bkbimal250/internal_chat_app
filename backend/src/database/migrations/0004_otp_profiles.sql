ALTER TABLE "users" ADD COLUMN "full_name" varchar(120);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_e164" varchar(16);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_photo_key" varchar(128);--> statement-breakpoint
UPDATE "users" SET "full_name" = "display_name" WHERE "full_name" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "full_name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_e164_unique" ON "users" USING btree ("phone_e164") WHERE "phone_e164" IS NOT NULL AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" varchar(16) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "otp_challenges_phone_idx" ON "otp_challenges" USING btree ("phone_e164","created_at");--> statement-breakpoint
CREATE INDEX "otp_challenges_expires_idx" ON "otp_challenges" USING btree ("expires_at");
