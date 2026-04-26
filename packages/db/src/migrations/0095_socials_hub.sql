-- Socials Hub — single source of truth for every social account the org
-- operates, plus a queryable mirror of automations driving them.
-- See docs/products/socials-hub.md.

CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  brand TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  connection_type TEXT NOT NULL DEFAULT 'manual',
  oauth_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  automation_mode TEXT NOT NULL DEFAULT 'manual',
  automation_notes TEXT,
  last_activity_at TIMESTAMPTZ,
  owner_user_id UUID,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_accounts_company_brand_platform_idx
  ON social_accounts (company_id, brand, platform);
CREATE INDEX IF NOT EXISTS social_accounts_platform_idx ON social_accounts (platform);
CREATE INDEX IF NOT EXISTS social_accounts_status_idx ON social_accounts (status);

CREATE TABLE IF NOT EXISTS social_automations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  social_account_id UUID REFERENCES social_accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  cron_expr TEXT,
  personality_id TEXT,
  content_type TEXT,
  source_ref TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_automations_source_ref_idx ON social_automations (source_ref);
CREATE INDEX IF NOT EXISTS social_automations_account_idx ON social_automations (social_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_automations_source_ref_uq ON social_automations (source_ref);
