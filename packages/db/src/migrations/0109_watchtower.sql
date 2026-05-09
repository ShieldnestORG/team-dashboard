-- 0109_watchtower.sql
-- Watchtower brand-mention monitor v1.
--
-- The cheap, in-house alternative to Profound/Peec brand-mention SaaS.
-- A subscription is one (brand_name, prompts[]) bundle. The weekly cron
-- replays each prompt against each engine (chatgpt/claude/perplexity/gemini)
-- and records whether the brand was mentioned, with a naive sentiment tag.
--
-- v1 mention detection = case-insensitive substring of brand_name OR domain
-- in the response text. v1 sentiment = keyword bag. Both are explicitly
-- placeholder-quality and documented as such in
-- docs/products/watchtower.md. Do NOT use these signals for marketing
-- claims until v2 detection ships.
--
-- Additive only: 3 tables + 2 indexes. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS watchtower_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID,                          -- nullable for v1; portal-auth lands w/ Worker A
  brand_name TEXT NOT NULL,
  domain TEXT,
  prompts JSONB NOT NULL,                   -- string[] of prompts to monitor
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','cancelled')),
  stripe_subscription_id TEXT,
  frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('weekly','daily')),
  prompt_cap INT NOT NULL DEFAULT 25,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchtower_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
    REFERENCES watchtower_subscriptions(id) ON DELETE CASCADE,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  engines TEXT[] NOT NULL,                  -- engines actually queried this run
  total_prompts INT NOT NULL,
  mention_count INT NOT NULL,
  summary JSONB
);

CREATE TABLE IF NOT EXISTS watchtower_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL
    REFERENCES watchtower_runs(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  engine TEXT NOT NULL
    CHECK (engine IN ('chatgpt','claude','perplexity','gemini')),
  mentioned BOOLEAN NOT NULL,
  sentiment TEXT
    CHECK (sentiment IN ('positive','neutral','negative','unknown')),
  excerpt TEXT,
  raw_response TEXT,
  latency_ms INT
);

CREATE INDEX IF NOT EXISTS watchtower_runs_sub_run_at_idx
  ON watchtower_runs (subscription_id, run_at DESC);

CREATE INDEX IF NOT EXISTS watchtower_results_run_idx
  ON watchtower_results (run_id);
