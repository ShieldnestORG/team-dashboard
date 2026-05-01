-- creditscore-backfill-degraded-2-update.sql
--
-- STEP 2 of 2 — destructive. Reclassifies fake-complete rows as
-- status='degraded' with score=NULL. Run ONLY after sanity-checking
-- the counts produced by creditscore-backfill-degraded-1-dryrun.sql.
--
-- The whole script is wrapped in a transaction with a fail-stop guard:
-- if the would_reclassify count exceeds MAX_EXPECTED, the transaction
-- raises and rolls back so a runaway WHERE clause can't nuke the table.
--
-- Tweak MAX_EXPECTED below before running. The 2026-04-30 outage was
-- expected to surface fewer than 200 rows; set this to 2× whatever the
-- dry-run reported.

BEGIN;

\set MAX_EXPECTED 500

DO $$
DECLARE
  match_count int;
BEGIN
  SELECT COUNT(*) INTO match_count
  FROM creditscore_reports
  WHERE
    status = 'complete'
    AND score < 35
    AND COALESCE((result_json->'breakdown'->'structuredData'->>'score')::int, 0) = 0
    AND COALESCE((result_json->'breakdown'->'contentQuality'->>'score')::int, 0)  = 0
    AND COALESCE((result_json->'breakdown'->'freshness'->>'score')::int, 0)       = 0;

  IF match_count > :MAX_EXPECTED THEN
    RAISE EXCEPTION
      'Refusing to reclassify % rows (limit %). Re-run dry-run script and lift MAX_EXPECTED if this is correct.',
      match_count, :MAX_EXPECTED;
  END IF;

  RAISE NOTICE 'Reclassifying % rows.', match_count;
END
$$;

UPDATE creditscore_reports
SET
  status     = 'degraded',
  score      = NULL,
  updated_at = NOW()
WHERE
  status = 'complete'
  AND score < 35
  AND COALESCE((result_json->'breakdown'->'structuredData'->>'score')::int, 0) = 0
  AND COALESCE((result_json->'breakdown'->'contentQuality'->>'score')::int, 0)  = 0
  AND COALESCE((result_json->'breakdown'->'freshness'->>'score')::int, 0)       = 0;

\echo ''
\echo '=== Status counts after reclassification ==='
SELECT status, COUNT(*) FROM creditscore_reports GROUP BY status ORDER BY status;

COMMIT;
