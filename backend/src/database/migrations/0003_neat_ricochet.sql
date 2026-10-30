CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'quarantined', 'available', 'rejected', 'deleted');--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'image';--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'video';--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'audio';--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'file';--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"message_id" uuid,
	"storage_key" varchar(128) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(127) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" varchar(64),
	"kind" varchar(16) NOT NULL,
	"status" "attachment_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"upload_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_storage_key_unique" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_conversation_idx" ON "attachments" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_uploader_idx" ON "attachments" USING btree ("uploader_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_status_idx" ON "attachments" USING btree ("status","upload_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_message_unique" ON "attachments" USING btree ("message_id");