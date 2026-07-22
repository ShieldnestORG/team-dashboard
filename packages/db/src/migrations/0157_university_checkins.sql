-- 0157_university_checkins.sql
-- Coherent Ones University — daily CHECK-INS, the "① Check in" leg of the
-- "Today's Three" daily loop (F2). One tap writes one idempotent day-unique row
-- signalling the member showed up today, independent of any lesson rep. The
-- UNION of check-in days and rep-days drives the streak (a day counts if it has
-- a check-in OR a rep) — see customer-portal.ts getProgressSummary and
-- university-crons.ts runUniversityStreakNudge, which BOTH read this table.
--
-- The day bucket is an explicit `checkin_day` DATE column (UTC), mirroring
-- university_progress.rep_day, so the day boundary is deterministic and the
-- idempotency constraint is trivial. The endpoint inserts with
-- ON CONFLICT (email, checkin_day) DO NOTHING, so a second tap on the same UTC
-- day is a clean no-op (never a 409). Member identity mirrors university_progress:
-- durable lowercased `email`, with `account_id` filled once the linker resolves.
--
-- Hand-written in the repo's forward-only convention (no drizzle journal/snapshot),
-- next free slot after 0156. Additive only; `IF NOT EXISTS` keeps it a safe no-op
-- on any environment that already has the table.

CREATE TABLE IF NOT EXISTS university_checkins (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  account_id  UUID        REFERENCES customer_accounts (id),
  email       TEXT        NOT NULL,
  checkin_day DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One check-in per member+day — the ON CONFLICT DO NOTHING target. Keyed on
-- email (the durable identity) so idempotency holds before the account link
-- resolves; account_id is carried for query convenience, not part of the key.
CREATE UNIQUE INDEX IF NOT EXISTS university_checkins_email_day_uq
  ON university_checkins (email, checkin_day);

CREATE INDEX IF NOT EXISTS university_checkins_email_idx
  ON university_checkins (email);

CREATE INDEX IF NOT EXISTS university_checkins_account_idx
  ON university_checkins (account_id);
