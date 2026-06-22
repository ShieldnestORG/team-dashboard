-- 0134_coherence_score_history.sql
-- Coherent Ones University — the "feel & see" Accomplishments view. This table
-- is the time-series spine of a member's coherence score: one append-only row
-- per recorded score, charted over time so a member can SEE the line move.
--
-- Every coherence check writes one row here (source='check'); the column is left
-- open so future score sources (e.g. an imported baseline, an admin adjustment)
-- can append without a schema change. The "current" score the portal shows is
-- simply the most recent row for the member.
--
-- The member is identified the same way the rest of University is — by the
-- shared customer_accounts login (account_id once the linker has fired) joined
-- on the lowercased `email` as the durable fallback. Both are stored so the
-- lookup works before AND after the account link resolves. Mirrors the 0123
-- table/index style. Additive only: 1 table + 1 index. Safe to apply.

CREATE TABLE IF NOT EXISTS coherence_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable join key
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  source TEXT NOT NULL DEFAULT 'check',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Charting + "current score" lookup: scan a member's history in time order.
CREATE INDEX IF NOT EXISTS coherence_score_history_email_created_idx
  ON coherence_score_history (email, created_at);
