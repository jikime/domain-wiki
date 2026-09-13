ALTER TABLE workspace ADD COLUMN mcp_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE mcp_access_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  domain_id uuid NOT NULL REFERENCES domain(id) ON DELETE CASCADE,
  project_id uuid REFERENCES project(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  permissions jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  call_window timestamptz NOT NULL DEFAULT now(),
  call_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,domain_id) REFERENCES domain(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,domain_id,project_id) REFERENCES project(workspace_id,domain_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX mcp_token_owner_idx ON mcp_access_token(workspace_id,owner_id);
--> statement-breakpoint
CREATE TABLE mcp_conversation (
  token_id uuid NOT NULL REFERENCES mcp_access_token(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  scope_key text NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  PRIMARY KEY(token_id,session_key,scope_key)
);
