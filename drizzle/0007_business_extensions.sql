CREATE TABLE "official_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"author_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text,
	"title" text NOT NULL,
	"state" text DEFAULT 'fetching' NOT NULL,
	"source_version_id" uuid,
	"sha256" text,
	"published_hint" text,
	"published_date" text,
	"effective_date" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"error_message" text,
	"checked_by" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_candidate_scope_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "official_candidate_request_unique" UNIQUE("workspace_id","author_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "official_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "official_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"origin" text NOT NULL,
	"path_prefix" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_site_scope_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "official_site_address_unique" UNIQUE("workspace_id","origin","path_prefix")
);
--> statement-breakpoint
CREATE TABLE "rfp_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfp_evidence" (
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	CONSTRAINT "rfp_evidence_version_id_chunk_id_pk" PRIMARY KEY("version_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "rfp_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"source_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"latest_version_id" uuid,
	"published_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfp_report_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "rfp_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"sections" jsonb NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"base_published_version_id" uuid,
	"origin" text DEFAULT 'manual' NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfp_version_scope_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "rfp_version_number_unique" UNIQUE("report_id","number")
);
--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_checked_by_app_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_workspace_id_site_id_official_site_workspace_id_id_fk" FOREIGN KEY ("workspace_id","site_id") REFERENCES "public"."official_site"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_candidate" ADD CONSTRAINT "official_candidate_workspace_id_source_version_id_source_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_version_id") REFERENCES "public"."source_version"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_decision" ADD CONSTRAINT "official_decision_candidate_id_official_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."official_candidate"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_decision" ADD CONSTRAINT "official_decision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_site" ADD CONSTRAINT "official_site_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_site" ADD CONSTRAINT "official_site_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_decision" ADD CONSTRAINT "rfp_decision_version_id_rfp_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."rfp_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_decision" ADD CONSTRAINT "rfp_decision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_evidence" ADD CONSTRAINT "rfp_evidence_workspace_id_version_id_rfp_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."rfp_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_evidence" ADD CONSTRAINT "rfp_evidence_workspace_id_chunk_id_source_chunk_workspace_id_id_fk" FOREIGN KEY ("workspace_id","chunk_id") REFERENCES "public"."source_chunk"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_report" ADD CONSTRAINT "rfp_report_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_report" ADD CONSTRAINT "rfp_report_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_report" ADD CONSTRAINT "rfp_report_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_report" ADD CONSTRAINT "rfp_report_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_report" ADD CONSTRAINT "rfp_report_workspace_id_source_id_source_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."source"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_version" ADD CONSTRAINT "rfp_version_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_version" ADD CONSTRAINT "rfp_version_workspace_id_report_id_rfp_report_workspace_id_id_fk" FOREIGN KEY ("workspace_id","report_id") REFERENCES "public"."rfp_report"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "official_candidate_queue_idx" ON "official_candidate" USING btree ("workspace_id","state","created_at");