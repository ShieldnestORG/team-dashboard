-- 0102_creditscore_reports_raw_data.sql
-- Adds raw_data JSONB column to creditscore_reports for full Firecrawl-response
-- replay/audit, and documents the new "degraded" status value.
--
-- Background: prior to this migration, every audit silently saved as
-- status:"complete" with score:30 when Firecrawl was unreachable. The
-- application now writes status:"degraded" for those rows so they can be
-- excluded from the report-mailing cron and upsell funnels. We do NOT add
-- a CHECK constraint because the status column is text-typed historically
-- and Drizzle's migration of the column to enum is out of scope here.
--
-- raw_data carries the full per-page Firecrawl payload (markdown, links,
-- metadata) so we can re-score historical reports without re-crawling once
-- Phase 2 signal upgrades land.
--
-- Additive only. Backfill of existing fake-complete rows is performed by
-- scripts/audit/creditscore-backfill-degraded.sql, run separately.

ALTER TABLE creditscore_reports
  ADD COLUMN IF NOT EXISTS raw_data JSONB;

COMMENT ON COLUMN creditscore_reports.status IS
  'pending | complete | failed | degraded — degraded means crawler returned partial/no data and the score is not trustworthy';

COMMENT ON COLUMN creditscore_reports.raw_data IS
  'Full per-page Firecrawl response (markdown/links/metadata) for replay and re-scoring. NULL for legacy rows.';
