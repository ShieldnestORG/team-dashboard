-- 0139_university_session_waitlist.sql
-- Coherent Ones University — LIVE SESSIONS waitlist.
--
-- Adds a third RSVP status value: 'waitlist'. When a finite-capacity session is
-- already full, a new RSVP is parked in status='waitlist' instead of being
-- rejected (409). When a `going` seat frees (member cancels), the OLDEST
-- waitlist row (by created_at) is promoted to `going` atomically.
--
-- `university_session_rsvps.status` is PLAIN TEXT (see 0127 line 65) — there is
-- NO Postgres ENUM type and NO CHECK constraint on it. So the new value needs
-- NO schema change to be storable: this migration is purely an additive INDEX to
-- keep the promote-on-cancel query (oldest waitlist row for a session) fast and
-- deterministic. Safe to apply against prod (CREATE INDEX IF NOT EXISTS).
--
-- The existing university_session_rsvps_session_status_idx (session_id, status)
-- already lets us filter to a session's waitlist rows; this index adds the
-- created_at ordering used to pick the single oldest waitlister for promotion.

CREATE INDEX IF NOT EXISTS university_session_rsvps_session_status_created_idx
  ON university_session_rsvps (session_id, status, created_at);
