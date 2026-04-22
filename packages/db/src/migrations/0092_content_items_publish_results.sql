-- Blog publish targets visibility: slug + per-target publish_results JSONB.
-- publish_results shape: { cd?: TargetResult, sn?: TargetResult, toknsApp?: TargetResult }
-- TargetResult: { success: boolean, error?: string, publishedAt?: string (ISO), url?: string }

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS publish_results jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS content_items_slug_idx ON content_items (slug) WHERE slug IS NOT NULL;
