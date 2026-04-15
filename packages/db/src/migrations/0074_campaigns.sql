-- Campaigns — group content items by brand initiative.
-- Allows scheduling, filtering, and reporting on content across brands.

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  brand TEXT NOT NULL DEFAULT 'cd',
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | active | paused | complete
  goal TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  target_sites JSONB DEFAULT '[]',
  personality_allowlist JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_company_id ON campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns(brand);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- Add campaign_id to content_items (soft reference — campaigns.id is UUID stored as TEXT)
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS campaign_id TEXT;

CREATE INDEX IF NOT EXISTS idx_content_items_campaign_id ON content_items(campaign_id);
