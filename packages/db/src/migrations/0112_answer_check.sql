-- 0112_answer_check.sql
-- Free single-prompt brand-mention check tool ("answer-check") at
-- coherencedaddy.com/tools/answer-check. Funnel-top wedge for Watchtower —
-- one-shot single-prompt run against all four engines, no subscription
-- needed. Email is captured AFTER the result is shown (post-result
-- email-gate); we want to land the conversion intent on the upsell CTA
-- regardless of whether the visitor leaves an email.
--
-- Per row we store the (brand, domain, prompt) inputs, the IP for abuse
-- tracking, the per-engine outcomes as JSONB, and three timestamps that
-- form the funnel: created_at → emailed_at → upsell_clicked_at.
--
-- Additive only. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS answer_check_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name TEXT NOT NULL,
  domain TEXT,
  prompt TEXT NOT NULL,
  email TEXT,
  ip TEXT,
  per_engine JSONB NOT NULL,
  mention_count INTEGER NOT NULL,
  engines_used TEXT[] NOT NULL,
  emailed_at TIMESTAMPTZ,
  upsell_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS answer_check_runs_email_idx
  ON answer_check_runs(email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS answer_check_runs_created_idx
  ON answer_check_runs(created_at DESC);
