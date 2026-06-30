-- 0138_university_session_recording_url.sql
-- Coherent Ones University — LIVE SESSIONS: manual recording link (v1).
--
-- Owner decision (2026-06-30): ship "manual paste-a-link" recordings now.
-- Admin records in Zoom Cloud / Meet / unlisted YouTube, then pastes that share
-- link into the session; members see a "Watch recording" link on past-session
-- cards. Zero new infrastructure — the link's own host handles storage,
-- streaming, and bandwidth. (Full auto-capture + gated replay is the heavy L
-- option documented in docs/plans/2026-06-30-session-recordings-storage.md.)
--
-- Additive only: one nullable column. Safe to apply against prod.

ALTER TABLE university_sessions
  ADD COLUMN IF NOT EXISTS recording_url TEXT;  -- nullable; manual Zoom/YouTube share link, shown to members on past sessions
