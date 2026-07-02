-- 0142_university_email_log.sql
-- Coherent Ones University — outbound lifecycle-email send log.
--
-- Most University lifecycle crons are naturally idempotent: their disjoint
-- time-windows (joined_at / updated_at / session start-time slices) hit each
-- recipient exactly once, so no send-log is needed. Two touches have NO natural
-- idempotency and need one:
--
--   university:streak-nudge — currently re-nudges an at-risk member EVERY day
--     the streak is at risk. This log powers a weekly frequency cap: skip anyone
--     with a 'university_streak_nudge' row in the last 7 days.
--   university:reengage     — the new 7/14/30-day-quiet check-in series. The
--     day-bucket match is the primary once-per-tier guard; this log is the
--     belt-and-suspenders dedup (skip the same kind for the same email within
--     30 days) so a flapping activity signal can't double-send.
--
-- The member is identified by the lowercased `email` (the durable join key used
-- across University). `kind` stores the CreditscoreEmailKind string sent. The
-- (email, kind, sent_at DESC) index serves the "was (email, kind) sent since
-- <cutoff>?" lookup both crons run, most-recent-first.
--
-- Additive only: 1 table + 1 index. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS university_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,                               -- lowercased recipient (durable join key)
  kind TEXT NOT NULL,                                -- CreditscoreEmailKind sent
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Frequency-cap / dedup lookup: "(email, kind) sent since <cutoff>?".
CREATE INDEX IF NOT EXISTS university_email_log_email_kind_sent_idx
  ON university_email_log (email, kind, sent_at DESC);
