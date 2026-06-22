-- 0135_coherence_check_submissions.sql
-- Coherent Ones University — the raw inputs behind each coherence score. A
-- "coherence check" is the member self-rating the three dials (body / focus /
-- direction, each 0..100); the composite `score` is computed deterministically
-- in the service (body*0.4 + focus*0.35 + direction*0.25, rounded) and stored
-- here alongside the inputs so the math is auditable and re-derivable.
--
-- Append-only: every check is its own row (no uniqueness key) — a member may
-- check in as often as they like, and each submission also writes a paired row
-- into coherence_score_history (source='check') so the chart line advances.
--
-- The member is identified the same way the rest of University is — by the
-- shared customer_accounts login (account_id once the linker has fired) joined
-- on the lowercased `email` as the durable fallback. Both are stored so the
-- lookup works before AND after the account link resolves. Mirrors the 0123
-- table/index style. Additive only: 1 table + 1 index. Safe to apply.

CREATE TABLE IF NOT EXISTS coherence_check_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable join key
  body INTEGER NOT NULL CHECK (body >= 0 AND body <= 100),
  focus INTEGER NOT NULL CHECK (focus >= 0 AND focus <= 100),
  direction INTEGER NOT NULL CHECK (direction >= 0 AND direction <= 100),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A member's check history in time order (parallels the score-history index).
CREATE INDEX IF NOT EXISTS coherence_check_submissions_email_created_idx
  ON coherence_check_submissions (email, created_at);
