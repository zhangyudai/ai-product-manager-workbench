-- M3 product workflow state. One current requirement analysis and one current
-- PRD per project; rows are owner-scoped so project data cannot cross users.
CREATE TABLE project_requirement_analyses (
    project_id       TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    owner_user_id    TEXT NOT NULL REFERENCES users(id),
    source_text      TEXT NOT NULL DEFAULT '',
    content          TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
    confirmed_by     TEXT,
    confirmed_at     INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_project_requirement_analyses_owner
    ON project_requirement_analyses(owner_user_id, updated_at DESC);

CREATE TABLE project_prds (
    project_id       TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
    owner_user_id    TEXT NOT NULL REFERENCES users(id),
    title            TEXT NOT NULL DEFAULT '',
    content          TEXT NOT NULL DEFAULT '',
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_project_prds_owner
    ON project_prds(owner_user_id, updated_at DESC);
