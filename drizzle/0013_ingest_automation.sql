CREATE TABLE "ingest_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"author_id" text NOT NULL,
	"origin" text NOT NULL,
	"basis_hash" text NOT NULL,
	"rules_hash" text NOT NULL,
	"profile" jsonb,
	"knowledge_stamp" jsonb NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"analysis_task_id" uuid,
	"generation_task_id" uuid,
	"reused_analysis" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_run_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_step" ADD COLUMN "cache_key" text;--> statement-breakpoint
ALTER TABLE "ai_step" ADD COLUMN "cache_origin_step_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_task" ADD COLUMN "ingest_run_id" uuid;--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "auto_ingest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_source_id_source_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."source"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_source_version_id_source_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_version_id") REFERENCES "public"."source_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_analysis_task_id_ai_task_workspace_id_id_fk" FOREIGN KEY ("workspace_id","analysis_task_id") REFERENCES "public"."ai_task"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_run" ADD CONSTRAINT "ingest_run_workspace_id_generation_task_id_ai_task_workspace_id_id_fk" FOREIGN KEY ("workspace_id","generation_task_id") REFERENCES "public"."ai_task"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_run_source_idx" ON "ingest_run" USING btree ("workspace_id","source_id","created_at");--> statement-breakpoint
CREATE INDEX "ingest_run_pending_idx" ON "ingest_run" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "ai_step_cache_idx" ON "ai_step" USING btree ("cache_key","state");