-- Owned utility-site network registry. Each row represents a site we own
-- (typically hosted on VPS3 nginx) that earns ad revenue. Metrics rows are
-- one per (site, date, source) and are upserted by the hostinger-crons
-- sync-metrics job from GA4 / AdSense / GSC.
-- See docs/products/utility-network/README.md for the strategy doc.

CREATE TABLE IF NOT EXISTS owned_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  slug TEXT NOT NULL,
  domain TEXT NOT NULL,
  display_name TEXT NOT NULL,
  primary_tool TEXT,
  niche TEXT,
  status TEXT NOT NULL DEFAULT 'building',
  launched_at TIMESTAMPTZ,
  adsense_account_id TEXT,
  ga_property_id TEXT,
  gsc_site_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS owned_sites_company_slug_uq ON owned_sites (company_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS owned_sites_domain_uq ON owned_sites (domain);
CREATE INDEX IF NOT EXISTS owned_sites_company_status_idx ON owned_sites (company_id, status);

CREATE TABLE IF NOT EXISTS owned_site_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES owned_sites(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  pageviews INTEGER NOT NULL DEFAULT 0,
  ad_impressions INTEGER NOT NULL DEFAULT 0,
  ad_revenue_cents INTEGER NOT NULL DEFAULT 0,
  rpm_cents INTEGER NOT NULL DEFAULT 0,
  outbound_clicks_to_coherence INTEGER NOT NULL DEFAULT 0,
  outbound_clicks_to_tokns INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS owned_site_metrics_site_date_source_uq
  ON owned_site_metrics (site_id, date, source);
CREATE INDEX IF NOT EXISTS owned_site_metrics_site_date_idx
  ON owned_site_metrics (site_id, date DESC);
