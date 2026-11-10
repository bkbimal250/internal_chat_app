ALTER TABLE "attachments" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "attachments_message_unique";--> statement-breakpoint
CREATE INDEX "attachments_message_idx" ON "attachments" USING btree ("message_id","sort_order");
