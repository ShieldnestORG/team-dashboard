-- Repo Update Suggestions — advisory SEO/AEO audit queue owned by Sage.
-- Stores per-audit-failure fix suggestions that the admin can approve,
-- reject, or reply to. Nothing is auto-pushed to any repo; this is a
-- human-in-the-loop queue that surfaces in the admin dashboard.

CREATE TABLE IF NOT EXISTS repo_update_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo TEXT NOT NULL,
  site_url TEXT NOT NULL,
  file_path TEXT,
  checklist_item TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',  -- critical | high | medium | low
  issue TEXT NOT NULL,
  rationale TEXT,
  proposed_patch TEXT,
  language TEXT NOT NULL DEFAULT 'typescript',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | needs_revision | applied
  admin_response TEXT,
  audit_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repo_update_suggestions_status
  ON repo_update_suggestions (status);
CREATE INDEX IF NOT EXISTS idx_repo_update_suggestions_repo
  ON repo_update_suggestions (repo);
CREATE INDEX IF NOT EXISTS idx_repo_update_suggestions_created
  ON repo_update_suggestions (created_at DESC);
