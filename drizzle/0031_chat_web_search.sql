ALTER TABLE chat_run ADD COLUMN web_references jsonb NOT NULL DEFAULT '[]'::jsonb;
