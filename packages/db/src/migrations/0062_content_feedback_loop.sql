-- Content Feedback Loop: persist quality signals + performance tracking
-- Gap 3: content_quality_signals table for persistent feedback penalties
-- Gap 4: performance tracking columns on content_items

-- Persistent quality signals (replaces in-memory downrank cache)
CREATE TABLE IF NOT EXISTS content_quality_signals (
  id SERIAL PRIMARY KEY,
  company_slug TEXT NOT NULL UNIQUE,
  penalty NUMERIC NOT NULL DEFAULT 1.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS content_quality_signals_slug_idx ON content_quality_signals (company_slug);

-- Performance tracking on content_items
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS engagement_score NUMERIC NOT NULL DEFAULT 0;
