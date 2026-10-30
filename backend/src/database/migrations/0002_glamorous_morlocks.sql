ALTER TABLE "conversations" ADD COLUMN "last_change_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "change_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "conversations" SET "last_change_seq" = "last_message_seq";--> statement-breakpoint
UPDATE "messages" SET "change_seq" = "sequence_number";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_change_unique" ON "messages" USING btree ("conversation_id","change_seq");--> statement-breakpoint
CREATE INDEX "messages_change_idx" ON "messages" USING btree ("conversation_id","change_seq");
