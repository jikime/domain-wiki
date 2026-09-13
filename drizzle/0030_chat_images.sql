CREATE TABLE chat_image (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0 AND ordinal < 5),
  name text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp','image/gif')),
  sha256 text NOT NULL,
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 5242880),
  CONSTRAINT chat_image_run_ordinal_unique UNIQUE (run_id, ordinal),
  FOREIGN KEY (workspace_id, run_id) REFERENCES chat_run(workspace_id, id) ON DELETE CASCADE
);
