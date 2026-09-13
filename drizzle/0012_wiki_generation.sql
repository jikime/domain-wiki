ALTER TABLE "ai_task" ADD COLUMN "analysis_task_id" uuid;--> statement-breakpoint
ALTER TABLE "change_batch" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "change_batch" ADD COLUMN "group_ordinal" integer;--> statement-breakpoint
ALTER TABLE "change_batch" ADD COLUMN "group_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "change_batch" ADD COLUMN "dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_version" ADD COLUMN "metadata" jsonb DEFAULT '{"type":"other","aliases":[],"links":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_task" ADD CONSTRAINT "ai_task_workspace_id_analysis_task_id_ai_task_workspace_id_id_fk" FOREIGN KEY ("workspace_id","analysis_task_id") REFERENCES "public"."ai_task"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_batch" ADD CONSTRAINT "change_batch_workspace_id_task_id_ai_task_workspace_id_id_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."ai_task"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_batch" ADD CONSTRAINT "batch_task_group_revision_unique" UNIQUE("task_id","group_ordinal","group_revision");