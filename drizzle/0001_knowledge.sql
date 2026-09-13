CREATE TYPE "public"."processing_state" AS ENUM('queued', 'processing', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."publication_state" AS ENUM('pending', 'published', 'rejected', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."wiki_state" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TABLE "review_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_version_id" uuid,
	"wiki_version_id" uuid,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"created_by" text NOT NULL,
	"latest_version_id" uuid,
	"published_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "source_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"locator" jsonb NOT NULL,
	CONSTRAINT "chunk_ordinal_unique" UNIQUE("version_id","ordinal"),
	CONSTRAINT "chunk_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "source_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"publication" "publication_state" DEFAULT 'pending' NOT NULL,
	"processing" "processing_state" DEFAULT 'queued' NOT NULL,
	"active_job_id" uuid,
	"parser_version" text,
	"error_message" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_version_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "source_version_number_unique" UNIQUE("source_id","number"),
	CONSTRAINT "source_version_hash_unique" UNIQUE("source_id","sha256"),
	CONSTRAINT "source_version_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "wiki_evidence" (
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	CONSTRAINT "wiki_evidence_version_id_chunk_id_pk" PRIMARY KEY("version_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"created_by" text NOT NULL,
	"latest_version_id" uuid,
	"published_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "wiki_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text NOT NULL,
	"base_published_version_id" uuid,
	"state" "wiki_state" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_version_number_unique" UNIQUE("page_id","number"),
	CONSTRAINT "wiki_version_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_scope_unique" UNIQUE("workspace_id","domain_id","id");--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_source_version_id_source_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."source_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_wiki_version_id_wiki_version_id_fk" FOREIGN KEY ("wiki_version_id") REFERENCES "public"."wiki_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_chunk" ADD CONSTRAINT "source_chunk_workspace_id_version_id_source_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."source_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_version" ADD CONSTRAINT "source_version_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_version" ADD CONSTRAINT "source_version_workspace_id_source_id_source_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."source"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_evidence" ADD CONSTRAINT "wiki_evidence_workspace_id_version_id_wiki_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."wiki_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_evidence" ADD CONSTRAINT "wiki_evidence_workspace_id_chunk_id_source_chunk_workspace_id_id_fk" FOREIGN KEY ("workspace_id","chunk_id") REFERENCES "public"."source_chunk"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_workspace_id_domain_id_project_id_project_workspace_id_domain_id_id_fk" FOREIGN KEY ("workspace_id","domain_id","project_id") REFERENCES "public"."project"("workspace_id","domain_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_version" ADD CONSTRAINT "wiki_version_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_version" ADD CONSTRAINT "wiki_version_workspace_id_page_id_wiki_page_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."wiki_page"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_domain_idx" ON "source" USING btree ("workspace_id","domain_id");--> statement-breakpoint
CREATE INDEX "source_version_hash_idx" ON "source_version" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "wiki_domain_idx" ON "wiki_page" USING btree ("workspace_id","domain_id");