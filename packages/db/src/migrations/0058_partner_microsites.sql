-- Phase 2: Partner microsites — expanded profile, site management, click tracking, content table

-- ── Business profile columns ────────────────────────────────────
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS hours jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS brand_colors jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS target_keywords jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS target_audience text;

-- ── Microsite management columns ────────────────────────────────
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS site_url text;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS site_repo_url text;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS site_deploy_status text NOT NULL DEFAULT 'none';
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS site_last_deployed_at timestamptz;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS site_config jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS site_vercel_project_id text;

-- ── Analytics baseline columns ──────────────────────────────────
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS baseline_analytics jsonb;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS baseline_captured_at timestamptz;

-- ── Content tracking columns ────────────────────────────────────
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS content_post_count integer NOT NULL DEFAULT 0;
ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS last_content_generated_at timestamptz;

-- ── Enhanced click tracking columns ─────────────────────────────
ALTER TABLE partner_clicks ADD COLUMN IF NOT EXISTS click_origin text NOT NULL DEFAULT 'cd';
ALTER TABLE partner_clicks ADD COLUMN IF NOT EXISTS visitor_type text;
ALTER TABLE partner_clicks ADD COLUMN IF NOT EXISTS utm_source text;
ALTER TABLE partner_clicks ADD COLUMN IF NOT EXISTS utm_medium text;
ALTER TABLE partner_clicks ADD COLUMN IF NOT EXISTS utm_campaign text;

-- ── Partner site content table ──────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_site_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partner_companies(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  slug text NOT NULL,
  title text NOT NULL,
  content_type text NOT NULL DEFAULT 'blog_post',
  body text NOT NULL,
  meta_description text,
  keywords jsonb,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  published_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS partner_companies_site_status_idx ON partner_companies (company_id, site_deploy_status);
CREATE INDEX IF NOT EXISTS partner_clicks_origin_idx ON partner_clicks (partner_slug, click_origin);
CREATE INDEX IF NOT EXISTS partner_site_content_partner_status_idx ON partner_site_content (partner_id, status);
CREATE INDEX IF NOT EXISTS partner_site_content_partner_created_idx ON partner_site_content (partner_id, created_at);
