CREATE TABLE "chat_citation" (
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	CONSTRAINT "chat_citation_run_id_key_pk" PRIMARY KEY("run_id","key")
);
--> statement-breakpoint
CREATE TABLE "chat_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"rating" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_author_run_unique" UNIQUE("author_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_run_role_unique" UNIQUE("run_id","role")
);
--> statement-breakpoint
CREATE TABLE "chat_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"scope" jsonb NOT NULL,
	"state" text DEFAULT 'running' NOT NULL,
	"model" text,
	"retrieval_mode" text,
	"error_message" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_request_unique" UNIQUE("conversation_id","request_id"),
	CONSTRAINT "run_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "content_embedding" (
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"vector" vector NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_embedding_kind_target_id_model_pk" PRIMARY KEY("kind","target_id","model")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"scope" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_scope_unique" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "chat_citation" ADD CONSTRAINT "chat_citation_workspace_id_run_id_chat_run_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."chat_run"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_workspace_id_run_id_chat_run_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."chat_run"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_workspace_id_run_id_chat_run_workspace_id_id_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."chat_run"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_run" ADD CONSTRAINT "chat_run_workspace_id_conversation_id_conversation_workspace_id_id_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."conversation"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_embedding" ADD CONSTRAINT "content_embedding_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_workspace_idx" ON "content_embedding" USING btree ("workspace_id","model");--> statement-breakpoint
CREATE INDEX "conversation_owner_idx" ON "conversation" USING btree ("workspace_id","owner_id");