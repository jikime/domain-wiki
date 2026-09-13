CREATE TABLE "source_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"locator" jsonb NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_asset_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "source_asset_name_unique" UNIQUE("version_id","name")
);
--> statement-breakpoint
ALTER TABLE "source_version" ADD COLUMN "relative_path" text;--> statement-breakpoint
ALTER TABLE "source_asset" ADD CONSTRAINT "source_asset_workspace_id_version_id_source_version_workspace_id_id_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."source_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;