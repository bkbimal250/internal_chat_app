CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"messages_enabled" boolean DEFAULT true NOT NULL,
	"sound" boolean DEFAULT true NOT NULL,
	"vibration" boolean DEFAULT true NOT NULL,
	"show_preview" boolean DEFAULT true NOT NULL,
	"show_sender_on_lock_screen" boolean DEFAULT true NOT NULL,
	"group_notifications" boolean DEFAULT true NOT NULL,
	"retention_reminders" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
