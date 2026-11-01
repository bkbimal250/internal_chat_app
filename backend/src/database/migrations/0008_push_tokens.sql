ALTER TABLE "devices" ADD COLUMN "push_token" varchar(4096);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "push_token_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "devices_push_token_idx" ON "devices" USING btree ("push_token");
