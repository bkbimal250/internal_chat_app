ALTER TABLE "otp_challenges" ADD COLUMN "purpose" varchar(16) DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD COLUMN "user_id" uuid;--> statement-breakpoint
CREATE INDEX "otp_challenges_purpose_idx" ON "otp_challenges" USING btree ("phone_e164","purpose","created_at");
