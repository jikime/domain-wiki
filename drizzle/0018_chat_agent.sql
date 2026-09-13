ALTER TABLE "chat_run" ADD COLUMN "tool_events" jsonb DEFAULT '[]'::jsonb NOT NULL;
