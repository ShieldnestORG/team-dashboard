-- Marketing agents (Beacon / Ledger / Mint / Scribe) — shared infra tables.
-- See server/src/services/marketing-skill-registry.ts for skill ownership
-- and docs/products/blog-distribution.md for surface map.

CREATE TABLE IF NOT EXISTS marketing_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_scope TEXT NOT NULL,
  channel TEXT NOT NULL,
  owner_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  payload JSONB NOT NULL DEFAULT '{}',
  cross_post_of_draft_id UUID REFERENCES marketing_drafts(id) ON DELETE SET NULL,
  reviewed_by_user_id UUID,
  reviewed_by_agent_id UUID,
  reviewed_at TIMESTAMPTZ,
  published_url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_drafts_company_scope_idx
  ON marketing_drafts (company_id, product_scope);
CREATE INDEX IF NOT EXISTS marketing_drafts_status_idx
  ON marketing_drafts (status);
CREATE INDEX IF NOT EXISTS marketing_drafts_owner_agent_idx
  ON marketing_drafts (owner_agent_id);
CREATE INDEX IF NOT EXISTS marketing_drafts_cross_post_idx
  ON marketing_drafts (cross_post_of_draft_id);

CREATE TABLE IF NOT EXISTS marketing_skill_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  skill_key TEXT NOT NULL,
  owner_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_skill_ownership_company_skill_idx
  ON marketing_skill_ownership (company_id, skill_key);
