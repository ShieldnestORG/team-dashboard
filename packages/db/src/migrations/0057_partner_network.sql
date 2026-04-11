-- AEO Partner Network: partner companies + click tracking
CREATE TABLE IF NOT EXISTS partner_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  location TEXT,
  website TEXT,
  description TEXT,
  services JSONB DEFAULT '[]',
  social_handles JSONB,
  contact_name TEXT,
  contact_email TEXT,
  tier TEXT NOT NULL DEFAULT 'proof',
  status TEXT NOT NULL DEFAULT 'trial',
  monthly_fee INTEGER,
  referral_fee_per_client INTEGER,
  content_mentions INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  dashboard_token TEXT,
  partner_since TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_companies_company_slug_uq ON partner_companies(company_id, slug);
CREATE INDEX IF NOT EXISTS partner_companies_company_status_idx ON partner_companies(company_id, status);
CREATE INDEX IF NOT EXISTS partner_companies_company_industry_idx ON partner_companies(company_id, industry);
CREATE UNIQUE INDEX IF NOT EXISTS partner_companies_dashboard_token_uq ON partner_companies(dashboard_token);

CREATE TABLE IF NOT EXISTS partner_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_slug TEXT NOT NULL,
  company_id UUID NOT NULL REFERENCES companies(id),
  source_content_id TEXT,
  source_type TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partner_clicks_partner_clicked_idx ON partner_clicks(partner_slug, clicked_at);
CREATE INDEX IF NOT EXISTS partner_clicks_company_clicked_idx ON partner_clicks(company_id, clicked_at);
