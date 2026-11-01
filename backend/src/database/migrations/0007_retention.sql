ALTER TABLE "messages" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
UPDATE "messages"
SET "expires_at" = GREATEST("created_at" + interval '90 days', now() + interval '90 days')
WHERE "expires_at" IS NULL AND "deleted_at" IS NULL;--> statement-breakpoint
UPDATE "messages"
SET "expires_at" = "created_at" + interval '90 days'
WHERE "expires_at" IS NULL;--> statement-breakpoint
CREATE INDEX "messages_expires_idx" ON "messages" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "messages_live_idx" ON "messages" ("conversation_id", "sequence_number") WHERE "expired_at" IS NULL;--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"reminders_enabled" boolean DEFAULT true NOT NULL,
	"cleanup_enabled" boolean DEFAULT false NOT NULL,
	"cleanup_approved_at" timestamp with time zone,
	"cleanup_approved_by" uuid,
	"existing_grace_days" integer DEFAULT 90 NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_cleanup_approved_by_users_id_fk" FOREIGN KEY ("cleanup_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "retention_policies" ("id", "retention_days", "reminders_enabled", "cleanup_enabled", "existing_grace_days", "legal_hold")
VALUES ('default', 90, true, false, 90, false);--> statement-breakpoint
CREATE TABLE "retention_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reason" varchar(255) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_holds" ADD CONSTRAINT "retention_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retention_holds_open_idx" ON "retention_holds" USING btree ("conversation_id","released_at");--> statement-breakpoint
CREATE TABLE "retention_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"window_key" varchar(8) NOT NULL,
	"expires_on" varchar(10) NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "retention_reminders" ADD CONSTRAINT "retention_reminders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retention_reminders_unique" ON "retention_reminders" USING btree ("conversation_id","window_key","expires_on");--> statement-breakpoint
CREATE TABLE "retention_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" varchar(500),
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "retention_jobs_status_idx" ON "retention_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE TABLE "retention_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"storage_key" varchar(160),
	"size_bytes" bigint,
	"error" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"downloaded_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "retention_exports" ADD CONSTRAINT "retention_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_exports" ADD CONSTRAINT "retention_exports_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retention_exports_user_idx" ON "retention_exports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" varchar(500) NOT NULL,
	"conversation_id" uuid,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");
