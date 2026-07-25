-- 0158_university_practice.sql
-- Coherent Education — member PRACTICE suite: habits, journal, activities.
-- Four tables backing the portal Routine / Journal / Track pages:
--
--   - university_habits             — a member's habit list (name, emoji,
--                                     optional catalog slug, times-per-week
--                                     target, time-of-day bucket, active flag).
--   - university_habit_completions  — one idempotent day-unique tick per
--                                     habit+day. The service inserts with
--                                     ON CONFLICT (habit_id, completion_day)
--                                     DO NOTHING and deletes to untick, so
--                                     repeat toggles are clean no-ops (never
--                                     a 409). ON DELETE CASCADE: ticks are
--                                     meaningless without their habit row.
--   - university_journal_entries    — one row per member+day: MIT (most
--                                     important task) + done flag, gratitude
--                                     and wins as JSONB string arrays, free
--                                     notes. Upserted with a partial merge
--                                     (only provided fields overwrite) on
--                                     ON CONFLICT (email, entry_day).
--                                     Deliberately NO mood/health scales —
--                                     the coherence check stays THE day
--                                     rating.
--   - university_activities         — aggregate-ONLY summaries of GPS
--                                     activities (type, start, duration,
--                                     distance). Route points NEVER reach the
--                                     server — full routes stay on the
--                                     member's device.
--
-- Day buckets are explicit UTC DATE columns (`completion_day`, `entry_day`),
-- mirroring university_progress.rep_day / university_checkins.checkin_day, so
-- day boundaries are deterministic and idempotency constraints are trivial.
--
-- Member identity mirrors university_progress / university_checkins /
-- university_notes: durable lowercased `email` as the unique-constraint key,
-- with nullable `account_id` filled once the customer-account-linker resolves
-- the shared login. Both are stored so lookups work before AND after the
-- account link resolves.
--
-- Hand-written in the repo's forward-only convention (no drizzle
-- journal/snapshot), next free slot after 0157. Additive only; `IF NOT EXISTS`
-- keeps it a safe no-op on any environment that already has the tables.

CREATE TABLE IF NOT EXISTS university_habits (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  account_id     UUID        REFERENCES customer_accounts (id),
  email          TEXT        NOT NULL,
  name           TEXT        NOT NULL,
  emoji          TEXT,
  -- Optional slug of the catalog habit this was adopted from (portal-side
  -- catalog); NULL for fully custom habits.
  catalog_slug   TEXT,
  times_per_week INTEGER     NOT NULL DEFAULT 7,
  time_of_day    TEXT        NOT NULL DEFAULT 'any',
  active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Defensive: contract ranges (route also validates).
  CONSTRAINT university_habits_times_per_week_ck CHECK (times_per_week BETWEEN 1 AND 7),
  CONSTRAINT university_habits_time_of_day_ck CHECK (
    time_of_day IN ('morning', 'afternoon', 'evening', 'any')
  )
);

-- One habit per member+name (case-insensitive) — backs the duplicate-name 400.
-- Keyed on email (the durable identity) so the constraint holds before the
-- account link resolves; account_id is carried for query convenience only.
CREATE UNIQUE INDEX IF NOT EXISTS university_habits_email_name_uq
  ON university_habits (email, lower(name));

CREATE INDEX IF NOT EXISTS university_habits_email_idx
  ON university_habits (email);

CREATE INDEX IF NOT EXISTS university_habits_account_idx
  ON university_habits (account_id);

CREATE TABLE IF NOT EXISTS university_habit_completions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  habit_id       UUID        NOT NULL REFERENCES university_habits (id) ON DELETE CASCADE,
  email          TEXT        NOT NULL,
  completion_day DATE        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One tick per habit+day — the ON CONFLICT DO NOTHING target. Untick deletes
-- the row, so repeat toggles in either direction are clean no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS university_habit_completions_habit_day_uq
  ON university_habit_completions (habit_id, completion_day);

CREATE INDEX IF NOT EXISTS university_habit_completions_email_day_idx
  ON university_habit_completions (email, completion_day);

CREATE TABLE IF NOT EXISTS university_journal_entries (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  account_id UUID        REFERENCES customer_accounts (id),
  email      TEXT        NOT NULL,
  entry_day  DATE        NOT NULL,
  -- Most Important Task for the day + whether it got done. NULL mit_done =
  -- not yet answered (distinct from an explicit No).
  mit        TEXT,
  mit_done   BOOLEAN,
  -- JSONB arrays of short strings (route caps: 3 items, 280 chars each).
  gratitude  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  wins       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One entry per member+day — the partial-merge upsert's ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS university_journal_entries_email_day_uq
  ON university_journal_entries (email, entry_day);

CREATE INDEX IF NOT EXISTS university_journal_entries_email_idx
  ON university_journal_entries (email);

CREATE TABLE IF NOT EXISTS university_activities (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  account_id    UUID        REFERENCES customer_accounts (id),
  email         TEXT        NOT NULL,
  activity_type TEXT        NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  duration_s    INTEGER     NOT NULL,
  distance_m    INTEGER     NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Defensive: contract ranges (route also validates). Max 24h / 500km.
  CONSTRAINT university_activities_type_ck CHECK (
    activity_type IN ('run', 'walk', 'hike', 'bike', 'other')
  ),
  CONSTRAINT university_activities_duration_ck CHECK (duration_s > 0 AND duration_s <= 86400),
  CONSTRAINT university_activities_distance_ck CHECK (distance_m >= 0 AND distance_m <= 500000)
);

-- Newest-first history list per member.
CREATE INDEX IF NOT EXISTS university_activities_email_started_idx
  ON university_activities (email, started_at DESC);
