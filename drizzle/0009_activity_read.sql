CREATE TABLE "activity_read" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"notification_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_read_workspace_id_user_id_notification_key_pk" PRIMARY KEY("workspace_id","user_id","notification_key")
);
--> statement-breakpoint
ALTER TABLE "activity_read" ADD CONSTRAINT "activity_read_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_read" ADD CONSTRAINT "activity_read_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;