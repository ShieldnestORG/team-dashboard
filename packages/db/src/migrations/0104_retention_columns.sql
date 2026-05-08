-- Retention sweep tracking columns. Set once when the nightly retention
-- cron trims a row's body, so subsequent runs skip it (idempotent).
-- See server/src/services/maintenance/retention-sweep.ts.

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS body_trimmed_at TIMESTAMPTZ;

ALTER TABLE marketing_drafts
  ADD COLUMN IF NOT EXISTS payload_trimmed_at TIMESTAMPTZ;

ALTER TABLE creditscore_content_drafts
  ADD COLUMN IF NOT EXISTS body_trimmed_at TIMESTAMPTZ;
