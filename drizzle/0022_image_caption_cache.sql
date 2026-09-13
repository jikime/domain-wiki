CREATE TABLE "image_caption_cache" (
	"workspace_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"caption" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_caption_cache_workspace_id_cache_key_pk" PRIMARY KEY("workspace_id","cache_key")
);
--> statement-breakpoint
ALTER TABLE "image_caption_cache" ADD CONSTRAINT "image_caption_cache_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;