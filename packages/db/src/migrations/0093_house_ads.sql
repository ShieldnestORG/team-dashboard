-- House ads — admin-managed in-house creatives served to *.coherencedaddy.com
-- subdomains while AdSense approval is pending (and as a permanent fallback).
-- See docs/products/house-ads.md.

CREATE TABLE IF NOT EXISTS house_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL,
  image_asset_id UUID NOT NULL REFERENCES assets(id),
  image_alt TEXT NOT NULL DEFAULT '',
  click_url TEXT NOT NULL,
  slot TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS house_ads_company_idx ON house_ads (company_id);
CREATE INDEX IF NOT EXISTS house_ads_slot_active_idx ON house_ads (slot, active);
