-- 0119_creditscore_audit_runs.sql
-- Per-audit diagnostic log. Every call to runAudit() inserts a row at start
-- and updates it on outcome — gives us a queryable audit trail for debugging
-- "why did this audit fail" without grepping rolling container logs.
--
-- Phase 3 of the original 2026-04-30 fail-loudly plan
-- (docs/plans/2026-04-30-creditscore-audit-fail-loudly.md), motivated by
-- the 2026-05-23 roguedefender.com failure where the audit emitted
-- "Crawler temporarily unavailable" but no server-side log was produced —
-- impossible to diagnose after the fact.
--
-- error_step values: "map" | "scrape" | "search" | "validation"
--   map        — Firecrawl /v1/map failed (likely crawler outage)
--   scrape     — /v1/map succeeded but every /v1/scrape failed (likely a
--                site-specific issue: site down, blocking bots, slow
--                HTTPS, anti-bot challenge)
--   search     — competitor discovery failed (non-fatal but tracked)
--   validation — passed scraping but isDegradedAuditResult flagged it
--
-- Additive only. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS creditscore_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The in-memory jobId emitted on POST /audit. Useful for correlating
  -- with SSE stream events and frontend logs. Not unique because a job
  -- could theoretically be retried (rare).
  job_id UUID NOT NULL,
  url TEXT NOT NULL,
  -- status: running | complete | error
  status TEXT NOT NULL DEFAULT 'running',
  -- Set on error: which pipeline step failed (see comment above).
  error_step TEXT,
  -- Human-readable summary of what went wrong. The exact text emitted to
  -- the SSE error event lives here too, so we know what the user saw.
  error_message TEXT,
  -- For status='error' due to scrape: array of {url, error} per failed
  -- scrape attempt. For other failure modes: typically null.
  scrape_failures JSONB,
  -- Diagnostic counts populated as the audit progresses. Useful for
  -- "audit X mapped 8 URLs but only 2 scrapes succeeded" investigations.
  pages_mapped INTEGER,
  pages_scraped INTEGER,
  -- Final score, only set on status='complete' (mirrors creditscore_reports.score).
  score INTEGER,
  -- Anonymous identifier for the requester. Helps spot abusive patterns
  -- without storing PII. Indexed for rate-limit forensics.
  client_ip TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  -- Convenience: finished_at - started_at in ms, set on outcome.
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS creditscore_audit_runs_started_idx
  ON creditscore_audit_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS creditscore_audit_runs_status_idx
  ON creditscore_audit_runs(status);

CREATE INDEX IF NOT EXISTS creditscore_audit_runs_url_idx
  ON creditscore_audit_runs(url);

CREATE INDEX IF NOT EXISTS creditscore_audit_runs_job_idx
  ON creditscore_audit_runs(job_id);
