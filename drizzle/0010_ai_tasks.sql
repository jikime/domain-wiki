CREATE TABLE "ai_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_step_ordinal_unique" UNIQUE("task_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "ai_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"source_version_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"rules_hash" text NOT NULL,
	"prompt_version" text NOT NULL,
	"profile" jsonb,
	"state" text DEFAULT 'waiting' NOT NULL,
	"active_job_id" uuid,
	"lease_token" uuid,
	"heartbeat_at" timestamp with time zone,
	"recoveries" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_task_request_unique" UNIQUE("workspace_id","author_id","request_id"),
	CONSTRAINT "ai_task_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "step_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_step" ADD CONSTRAINT "ai_step_task_id_ai_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."ai_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task" ADD CONSTRAINT "ai_task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task" ADD CONSTRAINT "ai_task_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task" ADD CONSTRAINT "ai_task_workspace_id_source_version_id_source_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_version_id") REFERENCES "public"."source_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task" ADD CONSTRAINT "ai_task_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task" ADD CONSTRAINT "ai_task_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_task_pending_idx" ON "ai_task" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "ai_task_source_idx" ON "ai_task" USING btree ("workspace_id","source_version_id","created_at");--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_task_id_ai_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."ai_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_step_id_ai_step_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."ai_step"("id") ON DELETE cascade ON UPDATE no action;