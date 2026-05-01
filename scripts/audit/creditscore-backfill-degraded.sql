-- creditscore-backfill-degraded.sql
--
-- ONE-SHOT data fix to run AFTER migration 0102 lands in prod.
-- Marks every existing creditscore_reports row that was silently saved
-- as status:"complete" while the Firecrawl crawler was unreachable.
--
-- Symptom (confirmed via live smoke test 2026-04-30 against
-- api.coherencedaddy.com):
--   - score < 35 (≈30 — only aiAccess + technical contributed)
--   - result_json->'pagesScraped' missing or = 0
--   - result_json->'breakdown'->'structuredData'->>'score' = '0'
--   - result_json->'breakdown'->'contentQuality'->>'score' = '0'
--   - result_json->'breakdown'->'freshness'->>'score' = '0'
--
-- These rows pollute analytics, trigger fake "your score dropped"
-- emails, and embarrass us if a customer ever sees the report.
--
-- USAGE:
--   1. Run inside a transaction so you can roll back if the count is wrong.
--   2. Read the SELECT counts FIRST, sanity-check vs what you'd expect
--      from a Firecrawl outage, then run the UPDATE.
--   3. After commit, verify no future rows with this signature appear.
--
-- DO NOT include in the auto-applied migration sequence — this is a
-- manual ops step, gated on the operator confirming the count.

BEGIN;

-- ── 1. Dry-run: how many rows would be reclassified? ─────────────────────────

SELECT
  COUNT(*) AS total_complete,
  COUNT(*) FILTER (WHERE score < 35)                                    AS low_score,
  COUNT(*) FILTER (
    WHERE
      score < 35
      AND COALESCE((result_json->'breakdown'->'structuredData'->>'score')::int, 0) = 0
      AND COALESCE((result_json->'breakdown'->'contentQuality'->>'score')::int, 0)  = 0
      AND COALESCE((result_json->'breakdown'->'freshness'->>'score')::int, 0)       = 0
  )                                                                     AS would_reclassify
FROM creditscore_reports
WHERE status = 'complete';

-- ── 2. Sample 10 rows so the operator can eyeball them ───────────────────────

SELECT
  id,
  domain,
  score,
  created_at,
  result_json->'breakdown'->'structuredData'->>'score' AS sd_score,
  result_json->'breakdown'->'contentQuality'->>'score' AS cq_score,
  result_json->'breakdown'->'freshness'->>'score'      AS fr_score,
  result_json->>'pagesScraped'                         AS pages_scraped
FROM creditscore_reports
WHERE
  status = 'complete'
  AND score < 35
  AND COALESCE((result_json->'breakdown'->'structuredData'->>'score')::int, 0) = 0
  AND COALESCE((result_json->'breakdown'->'contentQuality'->>'score')::int, 0)  = 0
  AND COALESCE((result_json->'breakdown'->'freshness'->>'score')::int, 0)       = 0
ORDER BY created_at DESC
LIMIT 10;

-- ── 3. The reclassification.  REVIEW BEFORE COMMITTING. ──────────────────────

UPDATE creditscore_reports
SET
  status     = 'degraded',
  -- Keep score nullable on degraded so dashboards / upsells can't surface it.
  score      = NULL,
  updated_at = NOW()
WHERE
  status = 'complete'
  AND score < 35
  AND COALESCE((result_json->'breakdown'->'structuredData'->>'score')::int, 0) = 0
  AND COALESCE((result_json->'breakdown'->'contentQuality'->>'score')::int, 0)  = 0
  AND COALESCE((result_json->'breakdown'->'freshness'->>'score')::int, 0)       = 0;

-- ── 4. Verify. ───────────────────────────────────────────────────────────────

SELECT status, COUNT(*) FROM creditscore_reports GROUP BY status ORDER BY status;

-- If counts look right:
--   COMMIT;
-- Otherwise:
--   ROLLBACK;
