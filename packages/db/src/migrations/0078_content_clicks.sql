-- Content click/view/share event log
-- Replaces the simple click_count/engagement_score increment-only approach
-- with a full per-event record including referrer, UTM params, visitor type, etc.

CREATE TABLE IF NOT EXISTS content_clicks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id TEXT NOT NULL,
  company_id     UUID REFERENCES companies(id),
  event_type     TEXT NOT NULL,
  referrer       TEXT,
  user_agent     TEXT,
  ip_hash        TEXT,
  click_origin   TEXT NOT NULL DEFAULT 'cd',
  visitor_type   TEXT,
  utm_source     TEXT,
  utm_medium     TEXT,
  utm_campaign   TEXT,
  clicked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_clicks_content_clicked_idx
  ON content_clicks (content_item_id, clicked_at);

CREATE INDEX IF NOT EXISTS content_clicks_company_clicked_idx
  ON content_clicks (company_id, clicked_at);
