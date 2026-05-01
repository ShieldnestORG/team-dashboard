-- creditscore-backfill-degraded-1-dryrun.sql
--
-- STEP 1 of 2 — read-only. Run this first to see how many rows would be
-- reclassified and to eyeball a sample. No writes, safe to `psql -f`.
--
-- Symptom (confirmed 2026-04-30 against api.coherencedaddy.com):
--   - score < 35 (≈30 — only aiAccess + technical contributed)
--   - result_json->'breakdown'->'structuredData'->>'score' = '0'
--   - result_json->'breakdown'->'contentQuality'->>'score' = '0'
--   - result_json->'breakdown'->'freshness'->>'score' = '0'
--
-- If the would_reclassify count looks reasonable for the outage window
-- (cross-check against the period Firecrawl was down), proceed to
-- creditscore-backfill-degraded-2-update.sql.

\echo '=== Counts ==='
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

\echo ''
\echo '=== Sample of the rows that would be reclassified ==='
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
