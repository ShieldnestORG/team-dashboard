-- Add brand column to content_items and visual_content_items.
-- Controls which X account / publish target each content item belongs to.
-- Valid values: 'cd' (Coherence Daddy), 'tokns' (tokns.fi), 'tx' (TX Blockchain),
--               'shieldnest' (ShieldNest), 'directory' (directory.coherencedaddy.com), 'partners'
-- Default 'cd' keeps all existing rows attributed to Coherence Daddy.

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'cd';

ALTER TABLE visual_content_items
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'cd';

-- Index for filtering by brand
CREATE INDEX IF NOT EXISTS idx_content_items_brand ON content_items(brand);
CREATE INDEX IF NOT EXISTS idx_visual_content_items_brand ON visual_content_items(brand);
