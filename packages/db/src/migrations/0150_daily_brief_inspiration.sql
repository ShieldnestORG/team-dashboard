-- 0150_daily_brief_inspiration.sql
-- Daily AI Brief + Inspiration Board (Phase 3). Two independent tables:
--
-- inspiration_items — link-paste board. Any marketing user pastes a link to
-- a good post they saved (Instagram or elsewhere) with an optional note.
-- status starts 'new'; the daily-brief cron reviews every 'new' row once a
-- day, writes ai_comment, and flips status to 'reviewed'. A human can also
-- 'archive' a row directly (creator or admin).
--
-- daily_briefs — one row per (company_id, brief_date): the AI's daily read
-- of the last 7 days across every channel (Zernio, X, captured leads,
-- University email events, Watchtower) plus a review of new
-- inspiration_items. `sections` is the parsed JSON payload — see
-- server/src/services/socials/daily-brief.ts for the shape (whatWorked,
-- underutilized, contentSuggestions, funnelSuggestions, inspirationReview,
-- llmVisibility, summary). On LLM parse failure a minimal fallback row is
-- stored instead of crashing the cron — sections.fallback.rawText carries
-- the unparsed response so nothing is silently lost.
--
-- Hand-written in the repo's forward-only convention (no drizzle
-- journal/snapshot), next free slot after 0148 — 0149 is reserved by the
-- parallel feat/funnel-library branch. Additive only; IF NOT EXISTS keeps
-- this a safe no-op on any environment that already has the tables.

CREATE TABLE IF NOT EXISTS inspiration_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id        UUID        NOT NULL REFERENCES companies(id),
  url               TEXT        NOT NULL,
  note              TEXT,
  -- text (not uuid) — better-auth user ids are non-uuid strings, consistent
  -- with social_posts.created_by_user_id.
  added_by_user_id  TEXT,
  status            TEXT        NOT NULL DEFAULT 'new',
  ai_comment        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inspiration_items_status_ck CHECK (status IN ('new', 'reviewed', 'archived'))
);

CREATE INDEX IF NOT EXISTS inspiration_items_company_status_idx
  ON inspiration_items (company_id, status, created_at);

CREATE TABLE IF NOT EXISTS daily_briefs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  company_id  UUID        NOT NULL REFERENCES companies(id),
  brief_date  DATE        NOT NULL,
  sections    JSONB       NOT NULL DEFAULT '{}',
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_briefs_company_date_uq
  ON daily_briefs (company_id, brief_date);
