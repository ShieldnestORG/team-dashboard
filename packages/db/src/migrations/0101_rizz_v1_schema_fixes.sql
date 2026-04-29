-- 0101_rizz_v1_schema_fixes.sql
-- V1.1 prep: close two gaps in tiktok_review_submissions surfaced when wiring
-- the comment-monitor that creates rows from raw @-mentions (no form yet).
--
-- 1. form_id was NOT NULL but @-mentioned rows have no form yet. Loosen to
--    nullable; the application enforces "form_id present before pipeline
--    advances past 'mentioned'".
-- 2. submitter_handle had no uniqueness, so the comment monitor's "dedupe
--    against existing handles" couldn't use ON CONFLICT DO NOTHING. Add a
--    unique index on (company_id, lower(submitter_handle)) — case-insensitive
--    because TikTok handles are case-insensitive but stored mixed-case.
--
-- Additive only. Safe to apply against prod with existing rows: no rows
-- currently exist beyond seeds, and the new constraints relax (nullable) or
-- de-duplicate (unique index) — neither will fail on existing data.

ALTER TABLE tiktok_review_submissions
  ALTER COLUMN form_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tiktok_review_submissions_company_handle_uniq
  ON tiktok_review_submissions (company_id, lower(submitter_handle));
