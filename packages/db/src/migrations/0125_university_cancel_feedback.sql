-- 0125_university_cancel_feedback.sql
-- Coherent Ones University — CANCEL feedback store. Captures the optional
-- free-text "why are you leaving?" a member gives when they cancel from the
-- portal save-flow.
--
-- Purely a feedback log: the actual cancel is a Stripe action (the save-flow
-- sets cancel_at_period_end=true on the member's University subscription); this
-- table only persists the churn reason for later review. It never gates access
-- and is not part of entitlement/billing logic.
--
-- The member is identified the same way the rest of University is — by the
-- shared customer_accounts login (account_id once the linker has fired) joined
-- on the lowercased `email` as the durable fallback. Both are stored so the row
-- is attributable before AND after the account link resolves. Append-only:
-- every cancel attempt is its own row (no uniqueness key) so repeated
-- cancel→reactivate→cancel cycles all leave a trace.
--
-- Mirrors the 0123/0124 table/index style. Additive only: 1 table + 2 indexes.
-- Safe to apply against prod.

CREATE TABLE IF NOT EXISTS university_cancel_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable join key
  reason TEXT,                                       -- optional free-text; a member can cancel silently
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS university_cancel_feedback_email_idx
  ON university_cancel_feedback (email);

CREATE INDEX IF NOT EXISTS university_cancel_feedback_account_idx
  ON university_cancel_feedback (account_id);
