ALTER TABLE "conversation_members" ADD COLUMN IF NOT EXISTS "pinned_at" timestamptz;
ALTER TABLE "conversation_members" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
