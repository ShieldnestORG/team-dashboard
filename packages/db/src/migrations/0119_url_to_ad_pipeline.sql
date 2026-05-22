-- 0119_url_to_ad_pipeline.sql
-- URL → product-ad video pipeline DB layer.
--
-- Extends yt_productions with the inputs/intermediates of the ad pipeline
-- (the source URL, the extracted brief, the planned scenes, and the ad mode),
-- and adds yt_ad_assets — one row per generated shot asset (product clip,
-- b-roll, text card, CTA) produced for a production.
--
-- Additive only. Safe to apply against prod.

ALTER TABLE yt_productions
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS brief JSONB,
  ADD COLUMN IF NOT EXISTS scene_plan JSONB,
  ADD COLUMN IF NOT EXISTS ad_mode TEXT;

CREATE TABLE IF NOT EXISTS yt_ad_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  production_id UUID NOT NULL REFERENCES yt_productions(id),
  shot_index INTEGER NOT NULL,
  kind TEXT NOT NULL, -- product|broll|text_card|cta
  backend TEXT, -- grok|gemini|fal|...
  object_key TEXT,
  content_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|ready|failed
  cost_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS yt_ad_assets_company_production_idx ON yt_ad_assets(company_id, production_id);
CREATE INDEX IF NOT EXISTS yt_ad_assets_production_shot_idx ON yt_ad_assets(production_id, shot_index);
