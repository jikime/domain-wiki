CREATE TABLE quality_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 domain_id uuid NOT NULL, project_id uuid, author_id text NOT NULL REFERENCES app_user(id), request_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('structural','semantic')), origin text NOT NULL CHECK(origin IN ('manual','scheduled','revision')),
 basis_hash text NOT NULL, snapshot jsonb NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed','outdated','canceled','interrupted')),
 lease_token uuid, coverage jsonb NOT NULL DEFAULT '{}', completed_steps integer NOT NULL DEFAULT 0, error_message text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,author_id,request_id),
 FOREIGN KEY(workspace_id,domain_id) REFERENCES domain(workspace_id,id),
 FOREIGN KEY(workspace_id,domain_id,project_id) REFERENCES project(workspace_id,domain_id,id)
);
CREATE UNIQUE INDEX quality_run_active_idx ON quality_run(workspace_id,domain_id,COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid),mode) WHERE state IN ('queued','running');
CREATE INDEX quality_run_pending_idx ON quality_run(state,updated_at);
CREATE TABLE quality_step (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL, ordinal integer NOT NULL,
 input jsonb NOT NULL, result jsonb, generation_id uuid REFERENCES generation(id) ON DELETE SET NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed')), UNIQUE(run_id,ordinal),
 FOREIGN KEY(workspace_id,run_id) REFERENCES quality_run(workspace_id,id) ON DELETE CASCADE
);
CREATE TABLE quality_finding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
 domain_id uuid NOT NULL, project_id uuid, scope_key text NOT NULL, finding_key text NOT NULL,
 mode text NOT NULL, kind text NOT NULL, severity text NOT NULL, title text NOT NULL, note text NOT NULL,
 page_ids jsonb NOT NULL, quotes jsonb NOT NULL DEFAULT '[]', purpose_question text, target_id uuid,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','triaged','deferred','resolved')), resolution text NOT NULL DEFAULT '', fixed_wiki_id uuid,
 run_id uuid NOT NULL, basis_hash text NOT NULL, occurrences integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,scope_key,finding_key), FOREIGN KEY(workspace_id,run_id) REFERENCES quality_run(workspace_id,id),
 FOREIGN KEY(workspace_id,domain_id) REFERENCES domain(workspace_id,id),
 FOREIGN KEY(workspace_id,domain_id,project_id) REFERENCES project(workspace_id,domain_id,id),
 FOREIGN KEY(workspace_id,fixed_wiki_id) REFERENCES wiki_page(workspace_id,id)
);
CREATE TABLE quality_policy (
 workspace_id uuid NOT NULL, domain_id uuid NOT NULL, author_id text NOT NULL REFERENCES app_user(id),
 mode text NOT NULL DEFAULT 'structural' CHECK(mode IN ('structural','semantic')), interval_days integer NOT NULL DEFAULT 0 CHECK(interval_days BETWEEN 0 AND 30),
 after_revision boolean NOT NULL DEFAULT false, last_basis_hash text, next_run_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,domain_id),
 FOREIGN KEY(workspace_id,domain_id) REFERENCES domain(workspace_id,id) ON DELETE CASCADE
);
