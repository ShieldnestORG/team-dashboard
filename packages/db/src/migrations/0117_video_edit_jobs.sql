-- 0117_video_edit_jobs.sql
-- Job queue for the Video Edit pipeline — the editing sibling of the YouTube
-- production pipeline. yt_productions SYNTHESIZES videos from a script;
-- video_edit_jobs EDITS real footage through browser-use/video-use (Python
-- subprocess) into a polished final.mp4.
--
-- engine is pluggable; the only current implementation is "video-use".
-- Stored paths live under VIDEO_EDIT_DATA_DIR on the server.
--
-- Additive only. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS video_edit_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  engine TEXT NOT NULL DEFAULT 'video-use',
  status TEXT NOT NULL DEFAULT 'pending', -- pending|running|ready|failed|canceled
  input_dir TEXT NOT NULL,
  edit_brief TEXT NOT NULL,
  options JSONB,
  output_path TEXT,
  duration_sec REAL,
  file_size_bytes BIGINT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_edit_jobs_company_status_idx
  ON video_edit_jobs(company_id, status);

CREATE INDEX IF NOT EXISTS video_edit_jobs_created_idx
  ON video_edit_jobs(created_at DESC);
