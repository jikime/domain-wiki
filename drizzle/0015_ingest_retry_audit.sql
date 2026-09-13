ALTER TABLE "operations_event" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;
