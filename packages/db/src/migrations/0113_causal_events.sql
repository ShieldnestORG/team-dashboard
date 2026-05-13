-- 0113_causal_events.sql
-- Causal-event modeling layer (PyRapide / RAPIDE-inspired).
--
-- The activity_log already records "this happened" rows. What's been missing
-- is a way to say "this happened *because of* that" — i.e. a causal edge
-- between events, the way Stanford's RAPIDE describes a system as a partial
-- order of events linked by `caused_by`. Without it, debugging a bad
-- Watchtower run or a stuck agent pipeline means stitching timestamps by
-- hand across 24 cron logs.
--
-- This migration is purely additive:
--
-- 1. activity_log gains:
--      - event_kind  — dotted namespace ("watchtower.query.sent",
--                      "agent.creditscore-content.run.started", ...). NULL
--                      for legacy rows; new recordEvent() writes always
--                      populate it.
--      - caused_by   — uuid[] of activity_log.id rows that caused this one.
--                      An array (not a single FK) because some events have
--                      multiple parents (e.g. a "run.completed" caused by
--                      every "query.response" in the run).
--
-- 2. New event_constraints table — declarative "every X must be followed by
--    Y within N ms" patterns. A single shared cron walks this table, checks
--    recent activity_log rows against each pattern, and alerts on
--    violations. Storing patterns as JSONB lets us edit them from the UI
--    without redeploys.
--
-- Safe to apply against prod. Both ALTER TABLE ops are non-blocking on
-- modern Postgres (column add + array column add).

ALTER TABLE activity_log
  ADD COLUMN IF NOT EXISTS event_kind TEXT,
  ADD COLUMN IF NOT EXISTS caused_by UUID[];

CREATE INDEX IF NOT EXISTS activity_log_event_kind_created_idx
  ON activity_log(event_kind, created_at DESC)
  WHERE event_kind IS NOT NULL;

-- INDEX SIZE NOTE
-- activity_log is high-volume (every agent run, every webhook, every plugin
-- event). A GIN index over a uuid[] column has overhead roughly proportional
-- to the *total number of array elements* across all rows that have
-- caused_by IS NOT NULL — typical row writes 1–4 parent ids, so expect the
-- index to be in the same order of magnitude as the column itself.
--
-- Order-of-magnitude estimate: at ~10k caused_by-populated rows/day × 2
-- avg parents × 16 bytes (uuid) + GIN posting tree overhead ≈ a few MB/day
-- index growth. Healthy for now.
--
-- FALLBACK IF GROWTH GETS PROBLEMATIC: this index only powers the
-- descendant-traversal query in `services/routes/causal-events.ts` (the
-- `caused_by @> ARRAY[$id]::uuid[]` containment lookup, 3 hops). It is NOT
-- on the hot write path of recordEvent / logActivity. Drop with:
--   DROP INDEX CONCURRENTLY activity_log_caused_by_gin_idx;
-- Descendant lookups will then become full scans of recent activity_log
-- rows (still survivable for the /causal-events UI's 3-hop walk, just
-- slower). The partial WHERE clause means the index ignores legacy rows.
CREATE INDEX IF NOT EXISTS activity_log_caused_by_gin_idx
  ON activity_log USING GIN (caused_by)
  WHERE caused_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  kind TEXT NOT NULL,
  pattern JSONB NOT NULL,
  max_lag_ms INTEGER NOT NULL DEFAULT 60000,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_violation_at TIMESTAMPTZ,
  violation_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_constraints_enabled_idx
  ON event_constraints(enabled)
  WHERE enabled = TRUE;
