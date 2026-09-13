CREATE TABLE "archive_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"path" text NOT NULL,
	"storage_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"created_by" text NOT NULL,
	"source_id" uuid,
	"page_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archive_file_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "archive_file_path_unique" UNIQUE("domain_id","path")
);
--> statement-breakpoint
ALTER TABLE "domain" ADD COLUMN "overview_markdown" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_file" ADD CONSTRAINT "archive_file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_file" ADD CONSTRAINT "archive_file_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_file" ADD CONSTRAINT "archive_file_workspace_id_domain_id_domain_workspace_id_id_fk" FOREIGN KEY ("workspace_id","domain_id") REFERENCES "public"."domain"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_file" ADD CONSTRAINT "archive_file_workspace_id_source_id_source_workspace_id_id_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."source"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_file" ADD CONSTRAINT "archive_file_workspace_id_page_id_wiki_page_workspace_id_id_fk" FOREIGN KEY ("workspace_id","page_id") REFERENCES "public"."wiki_page"("workspace_id","id") ON DELETE no action ON UPDATE no action;