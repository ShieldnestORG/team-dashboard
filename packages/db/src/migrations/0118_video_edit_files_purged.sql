-- 0118_video_edit_files_purged.sql
-- Adds files_purged_at to video_edit_jobs so the cleanup cron can mark which
-- rows had their MP4 output deleted (vs. nulling outputPath, which would lose
-- the audit trail of where the file used to live).
--
-- Mirrors yt_productions.files_purged_at (added in an earlier migration).
-- Cron predicate after this lands: `status = 'ready' AND files_purged_at IS NULL
-- AND completed_at < now() - '30 days'::interval`.
--
-- Additive only. Safe to apply against prod.

ALTER TABLE video_edit_jobs
  ADD COLUMN IF NOT EXISTS files_purged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS video_edit_jobs_purge_candidates_idx
  ON video_edit_jobs(company_id, completed_at)
  WHERE status = 'ready' AND files_purged_at IS NULL;
