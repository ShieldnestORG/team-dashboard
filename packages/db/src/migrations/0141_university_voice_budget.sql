-- 0141_university_voice_budget.sql
-- Rex realtime-voice monthly budget (Phase 1) — integrated onto master 2026-07-01.
--
-- This schema originally shipped on the isolated `deploy/rex-voice-only` branch as a
-- drizzle-kit-generated `0137_aspiring_crystal.sql`, which COLLIDED with master's
-- hand-written `0137_university_agent_config.sql`. This is the identical schema,
-- hand-written in the repo's forward-only convention (no drizzle journal/snapshot),
-- renumbered to the next free slot (0141, after Tier 2's 0140).
--
-- The tables already exist in prod (they were applied when Rex Phase 1 ran on the
-- isolated branch), so `IF NOT EXISTS` makes this a safe no-op there while remaining
-- correct on a fresh environment. Additive only.

CREATE TABLE IF NOT EXISTS university_voice_meter (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  member_id    UUID        NOT NULL,
  period_start DATE        NOT NULL,
  seconds_used BIGINT      NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS university_voice_reservations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  member_id       UUID        NOT NULL,
  period_start    DATE        NOT NULL,
  granted_seconds INTEGER     NOT NULL,
  actual_seconds  INTEGER,
  status          TEXT        NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at      TIMESTAMPTZ,
  CONSTRAINT university_voice_reservations_status_ck CHECK (status IN ('open', 'settled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS university_voice_meter_member_period_uq
  ON university_voice_meter (member_id, period_start);
CREATE INDEX IF NOT EXISTS university_voice_reservations_member_period_idx
  ON university_voice_reservations (member_id, period_start);
