-- 0145_university_coherence_checks.sql
-- Coherent Ones University — coherence self-check (the "how coherent am I right
-- now?" dial). A member rates three axes (body / focus / direction, each 0..100)
-- and the backend stores a fixed-weight 0..100 score:
--   round(body*0.4 + focus*0.35 + direction*0.25)
-- Backs GET /api/portal/university/coherence + POST /university/coherence-check.
--
-- Hand-written in the repo's forward-only convention (no drizzle journal/snapshot),
-- next free slot after 0144. Additive only; `IF NOT EXISTS` keeps it a safe no-op
-- on any environment that already has the table. Member identity is the same
-- university_members id used by university_voice_meter (resolveVoiceMemberId).

CREATE TABLE IF NOT EXISTS university_coherence_checks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  member_id  UUID        NOT NULL,
  body       INTEGER     NOT NULL,
  focus      INTEGER     NOT NULL,
  direction  INTEGER     NOT NULL,
  score      INTEGER     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT university_coherence_checks_range_ck CHECK (
    body BETWEEN 0 AND 100
    AND focus BETWEEN 0 AND 100
    AND direction BETWEEN 0 AND 100
    AND score BETWEEN 0 AND 100
  )
);

CREATE INDEX IF NOT EXISTS university_coherence_checks_member_created_idx
  ON university_coherence_checks (member_id, created_at DESC);
