CREATE TABLE "source_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid NOT NULL,
	"project_id" uuid,
	"created_by" text NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"mode" text NOT NULL,
	"root_key" text,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"interval_minutes" integer DEFAULT 5 NOT NULL,
	"next_scan_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scan_at" timestamp with time zone,
	"state" text DEFAULT 'idle' NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_import_file" (
	"import_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"source_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing" boolean DEFAULT false NOT NULL,
	CONSTRAINT "source_import_file_import_id_relative_path_pk" PRIMARY KEY("import_id","relative_path")
);
--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "source_import_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "source_import_domain_id_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domain"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "source_import_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "source_import_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_file" ADD CONSTRAINT "source_import_file_import_id_source_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."source_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_file" ADD CONSTRAINT "source_import_file_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_file" ADD CONSTRAINT "source_import_file_version_id_source_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."source_version"("id") ON DELETE cascade ON UPDATE no action;