-- 0097_launch_comment_monitor.sql
-- Launch Comment Monitor — track HN/Reddit/dev.to launch posts and surface
-- pattern-classified comments to the Inbox for human-in-the-loop reply.
--
-- Additive only: two tables + three indexes. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS launch_tracked_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                 -- hn | reddit | devto
  external_id TEXT NOT NULL,              -- HN item id | reddit post id | devto article id
  title TEXT,
  post_url TEXT,
  watch_until TIMESTAMPTZ NOT NULL,       -- stop polling after this
  last_polled_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, platform, external_id)
);

CREATE TABLE IF NOT EXISTS comment_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tracked_item_id UUID NOT NULL REFERENCES launch_tracked_items(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  external_comment_id TEXT NOT NULL,
  external_comment_url TEXT NOT NULL,
  author TEXT,
  comment_body TEXT NOT NULL,
  pattern_id TEXT,                        -- one of the 8 pattern keys, or null
  confidence NUMERIC(3,2),                -- 0.00..1.00
  suggested_reply TEXT,                   -- only populated if confidence >= 0.85
  status TEXT NOT NULL DEFAULT 'pending', -- pending | replied | dismissed | needs_custom
  dismissed_reason TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(platform, external_comment_id)
);

CREATE INDEX IF NOT EXISTS comment_replies_status_idx ON comment_replies(status);
CREATE INDEX IF NOT EXISTS comment_replies_company_status_idx ON comment_replies(company_id, status);
CREATE INDEX IF NOT EXISTS launch_tracked_items_active_idx ON launch_tracked_items(active, watch_until);
