CREATE TABLE "batch_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"author_id" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"origin" text NOT NULL,
	"predecessor_id" uuid,
	"items" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"model" text,
	"batch_id" uuid,
	"result" jsonb,
	"error_message" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_request_unique" UNIQUE("workspace_id","author_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "source_version" ADD COLUMN "testimony" jsonb;--> statement-breakpoint
ALTER TABLE "batch_decision" ADD CONSTRAINT "batch_decision_batch_id_change_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."change_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_decision" ADD CONSTRAINT "batch_decision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_batch" ADD CONSTRAINT "change_batch_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_batch" ADD CONSTRAINT "change_batch_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_batch" ADD CONSTRAINT "change_batch_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_batch" ADD CONSTRAINT "change_batch_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_batch_id_change_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."change_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "batch_queue_idx" ON "change_batch" USING btree ("workspace_id","state","created_at");--> statement-breakpoint
CREATE INDEX "generation_active_idx" ON "generation" USING btree ("workspace_id","state");