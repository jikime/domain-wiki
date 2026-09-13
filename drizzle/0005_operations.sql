CREATE TABLE "content_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"resolution" text DEFAULT '' NOT NULL,
	"fixed_wiki_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operations_policy" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"concurrency" integer DEFAULT 3 NOT NULL,
	"retention_days" integer DEFAULT 365 NOT NULL,
	"input_price" integer,
	"output_price" integer,
	"currency" text DEFAULT 'KRW' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"assignee_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_assignment_workspace_id_kind_target_id_pk" PRIMARY KEY("workspace_id","kind","target_id")
);
--> statement-breakpoint
CREATE TABLE "review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_issue" ADD CONSTRAINT "content_issue_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_issue" ADD CONSTRAINT "content_issue_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_event" ADD CONSTRAINT "operations_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_event" ADD CONSTRAINT "operations_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations_policy" ADD CONSTRAINT "operations_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_event" ADD CONSTRAINT "review_event_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION source_is_current(root_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
WITH RECURSIVE deps(id) AS (
 SELECT root_id UNION
 SELECT c.version_id FROM deps d JOIN source_version v ON v.id=d.id
 CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(v.testimony->'chunkIds','[]'::jsonb)) r(chunk)
 JOIN source_chunk c ON c.id=r.chunk::uuid
)
SELECT EXISTS(SELECT 1 FROM source_version WHERE id=root_id) AND NOT EXISTS (
 SELECT 1 FROM deps d JOIN source_version v ON v.id=d.id JOIN source s ON s.id=v.source_id
 WHERE s.published_version_id IS DISTINCT FROM v.id OR v.publication<>'published' OR v.processing<>'completed'
 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(v.testimony->'chunkIds','[]'::jsonb)) r(chunk)
 LEFT JOIN source_chunk c ON c.id=r.chunk::uuid AND c.workspace_id=v.workspace_id WHERE c.id IS NULL)
)
$$;
--> statement-breakpoint
ALTER TABLE operations_policy ADD CONSTRAINT operations_policy_limits CHECK (concurrency BETWEEN 1 AND 20 AND retention_days BETWEEN 1 AND 3650 AND (input_price IS NULL OR input_price>=0) AND (output_price IS NULL OR output_price>=0));
--> statement-breakpoint
CREATE INDEX issue_queue_idx ON content_issue(workspace_id,state,created_at);
--> statement-breakpoint
CREATE INDEX review_event_target_idx ON review_event(workspace_id,kind,target_id,created_at);
