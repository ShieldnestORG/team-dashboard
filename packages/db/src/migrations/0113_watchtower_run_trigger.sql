-- 0113_watchtower_run_trigger.sql
-- Watchtower: record how each run was triggered.
--
-- Phase 2 adds a customer-facing "Run now" button. To enforce the manual-run
-- rate limits (1/24h + 5/30d per subscription, 50/hour global) the limiter
-- has to distinguish manual runs from the weekly cron and from internal QA
-- triggers — otherwise a cron run would "use up" a customer's daily quota.
--
-- trigger values:
--   cron   → the Monday weekly-runs job (default; all pre-existing rows)
--   manual → customer pressed "Run now" in the portal
--   test   → internal /runs/:id/trigger-test QA helper
--
-- The (trigger, run_at DESC) index backs the global hourly-cap count query.
--
-- Additive only: 1 column + 1 index. Safe to apply against prod.

ALTER TABLE watchtower_runs
  ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL DEFAULT 'cron'
  CHECK (trigger IN ('cron','manual','test'));

CREATE INDEX IF NOT EXISTS watchtower_runs_trigger_run_at_idx
  ON watchtower_runs (trigger, run_at DESC);
