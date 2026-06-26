-- 0127_university_sessions.sql
-- Coherent Ones University — native in-portal LIVE SESSIONS (scheduling + RSVP).
-- The "Practice together" leg of the Coherent Loop (Read → Do → Practice
-- together). Admin-created scheduled group sits; members RSVP, get reminded
-- (T-24h / T-1h), and one-click join an external video room when it's live.
--
-- Two tables:
--   - university_sessions       — the scheduled session (admin/global object;
--                                 NOT owned by a member). starts_at is the
--                                 single source of truth for lifecycle
--                                 (upcoming → live → ended), computed from the
--                                 clock, never stored.
--   - university_session_rsvps  — one row per (member, session). The member is
--                                 identified the same way the rest of
--                                 University is — by the lowercased `email`
--                                 (the durable join key) with `account_id`
--                                 carried for convenience once the linker
--                                 resolves it. UNIQUE(session_id, email) is the
--                                 idempotent upsert/cancel key.
--
-- The external video room is stored as a plain `join_url` string
-- (Zoom/Meet/Whereby) — provider-agnostic; switching providers is a data
-- change, not a code change. The service NEVER returns join_url unless the
-- session is live AND the caller RSVP'd `going` (no room-link leak).
--
-- recurrence_rule / recurrence_group ship NULL at MVP (one-off rows only) so
-- the v2 recurrence generator needs no second migration; they are inert.
--
-- Mirrors the 0122–0125 table/index style. Additive only: 2 tables + indexes.
-- Safe to apply against prod (CREATE … IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS university_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              TEXT NOT NULL,                          -- e.g. "Sunday Coherence Sit"
  description        TEXT,                                   -- optional what-we'll-do blurb
  host_name          TEXT NOT NULL,                          -- display host, e.g. "Mark"
  host_email         TEXT,                                   -- optional internal contact (not shown)
  starts_at          TIMESTAMPTZ NOT NULL,                   -- the instant the session starts (UTC)
  duration_minutes   INTEGER NOT NULL DEFAULT 60,            -- for ICS end + "ends ~" display
  join_url           TEXT NOT NULL,                          -- external video room (Zoom/Meet/Whereby)
  capacity           INTEGER,                                -- nullable = unlimited
  status             TEXT NOT NULL DEFAULT 'scheduled',      -- scheduled | canceled
  -- v2 recurrence (NULL at MVP; one-off rows only):
  recurrence_rule    TEXT,                                   -- iCal RRULE string, e.g. 'FREQ=WEEKLY;BYDAY=SU'
  recurrence_group   UUID,                                   -- shared id across a generated series
  created_by_account UUID REFERENCES customer_accounts(id),  -- the admin who created it (audit)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS university_sessions_starts_at_idx
  ON university_sessions (starts_at);

CREATE INDEX IF NOT EXISTS university_sessions_status_idx
  ON university_sessions (status);

CREATE INDEX IF NOT EXISTS university_sessions_recurrence_group_idx
  ON university_sessions (recurrence_group);

CREATE TABLE IF NOT EXISTS university_session_rsvps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES university_sessions(id),
  account_id    UUID REFERENCES customer_accounts(id),  -- nullable until linker resolves
  email         TEXT NOT NULL,                          -- lowercased; the durable member key
  status        TEXT NOT NULL DEFAULT 'going',          -- going | canceled
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS university_session_rsvps_session_email_uq
  ON university_session_rsvps (session_id, email);

CREATE INDEX IF NOT EXISTS university_session_rsvps_session_status_idx
  ON university_session_rsvps (session_id, status);

CREATE INDEX IF NOT EXISTS university_session_rsvps_email_idx
  ON university_session_rsvps (email);

CREATE INDEX IF NOT EXISTS university_session_rsvps_account_idx
  ON university_session_rsvps (account_id);
