-- YouTube Pipeline — feedback loop & file lifecycle tracking
-- Adds files_purged_at to yt_productions so the 30-day cleanup cron can
-- track which productions have had their video/audio/captions deleted.

ALTER TABLE yt_productions
  ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ;

-- Partial index: only non-purged rows that are old enough to be candidates.
CREATE INDEX IF NOT EXISTS yt_productions_purge_candidates_idx
  ON yt_productions (company_id, created_at)
  WHERE files_purged_at IS NULL;
