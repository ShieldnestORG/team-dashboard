-- 0140_university_agent_runner_state.sql
-- Coherent Ones University — DURABLE agent-runner posting state.
--
-- Root-cause fix for the duplicate-post bug: the community-agent runner kept its
-- daily post/comment counters, per-agent consecutive-post streak, and the 72h
-- post_line anti-repeat ledger in memory (plain Maps in agent-runner/state.ts).
-- On every deploy/restart those reset to zero, so an agent could immediately
-- re-post a line/topic it had just used and blow past the daily caps. These
-- tables move that state into Postgres so it survives restarts.
--
-- NOTE: the RESPONSIVE feed watermark is already re-derived from
-- university_community_posts on boot (engine.initWatermark) and is NOT
-- duplicated here. university_agent_watermark below is a GENERAL per-agent
-- cursor store — it is intentionally general enough to also hold a 'comment'
-- cursor for the Tier 3 comment-poller (integration will point that here).
--
-- Additive + idempotent only (CREATE TABLE/INDEX IF NOT EXISTS): safe to auto-
-- apply against prod on boot via the filename-ordered runner. No _journal.json
-- edit (0138/0139 are likewise hand-written and out of the drizzle journal).

-- Per-agent, per-UTC-day posting ledger + budget. One row per (persona, day).
-- posts_count / comments_count back the global + per-agent daily caps;
-- consecutive_posts backs the "<=2 consecutive posts/agent" cap (reset to 0 by
-- an interleaved comment, mirroring the old in-memory streak, and naturally
-- bucketed per UTC day). spend_usd is reserved for a future per-agent daily
-- spend rollup (the live spend ceiling still sums university_agent_usage); the
-- runner does not write it yet.
CREATE TABLE IF NOT EXISTS university_agent_daily_budget (
  agent_persona_key  TEXT        NOT NULL,
  day                DATE        NOT NULL,
  posts_count        INTEGER     NOT NULL DEFAULT 0,
  comments_count     INTEGER     NOT NULL DEFAULT 0,
  consecutive_posts  INTEGER     NOT NULL DEFAULT 0,
  last_post_at       TIMESTAMPTZ,
  spend_usd          NUMERIC(12,6) NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_persona_key, day)
);

-- Fast "today's global totals" scan (SUM over a single day across personas).
CREATE INDEX IF NOT EXISTS university_agent_daily_budget_day_idx
  ON university_agent_daily_budget (day);

-- The 72h post_line anti-repeat ledger. One row per ambient scripted-line use.
-- line_hash is a stable digest of the line (sha256 hex) used for the anti-repeat
-- lookup; line_text is kept alongside for admin debugging. The dedup query is
-- "does this persona have a row for this line_hash within the last 72h?".
CREATE TABLE IF NOT EXISTS university_agent_line_usage (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_persona_key  TEXT        NOT NULL,
  line_hash          TEXT        NOT NULL,
  line_text          TEXT        NOT NULL DEFAULT '',
  used_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covers the anti-repeat dedup lookup (persona + line within a recency window)
-- and the recent-usage hydration scan (persona, newest first).
CREATE INDEX IF NOT EXISTS university_agent_line_usage_persona_line_used_idx
  ON university_agent_line_usage (agent_persona_key, line_hash, used_at DESC);
CREATE INDEX IF NOT EXISTS university_agent_line_usage_persona_used_idx
  ON university_agent_line_usage (agent_persona_key, used_at DESC);

-- General per-agent cursor store. kind = 'ambient' | 'comment' | ... — one row
-- per (persona, kind). last_seen_at/last_id are a durable watermark the runner
-- (and the Tier 3 comment-poller) can advance monotonically. NOT used to
-- duplicate the responsive feed watermark (that stays DB-derived on boot).
CREATE TABLE IF NOT EXISTS university_agent_watermark (
  agent_persona_key  TEXT        NOT NULL,
  kind               TEXT        NOT NULL,
  last_seen_at       TIMESTAMPTZ,
  last_id            TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_persona_key, kind)
);

-- Supports the Tier 3 comment-poller's GLOBAL new-comment scan in
-- agent-runner/engine.ts commentTick:
--   WHERE status = 'visible' AND created_at > <watermark> ORDER BY created_at ASC
-- The existing comments indexes lead with post_id (thread render) or
-- author_email/account_id, none of which serve this global range+sort — without
-- this index the poller sequential-scans university_community_comments every 30s,
-- a cost that grows with the table. This turns it into an index range scan over
-- the newest-visible rows. Additive + idempotent; the leading status column also
-- keeps 'hidden'/'removed' rows out of the hot path.
CREATE INDEX IF NOT EXISTS university_community_comments_status_created_idx
  ON university_community_comments (status, created_at);
