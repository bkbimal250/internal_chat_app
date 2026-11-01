ALTER TABLE "conversations" ADD COLUMN "edit_info_policy" varchar(16) DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "send_messages_policy" varchar(16) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "add_members_policy" varchar(16) DEFAULT 'admins' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_edit_info_policy_check" CHECK ("edit_info_policy" in ('all','admins'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_send_messages_policy_check" CHECK ("send_messages_policy" in ('all','admins'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_add_members_policy_check" CHECK ("add_members_policy" in ('all','admins'));
