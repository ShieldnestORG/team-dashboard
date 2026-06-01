-- 0119_watchtower_rank.sql
-- Adds opt-in Google-rank tracking to Watchtower subscriptions.
--
-- Watchtower v1 measures AEO/GEO (AI-engine brand mentions). This adds a
-- classical SEO signal: for opted-in subscriptions, the weekly run also
-- queries the self-hosted Firecrawl /v1/search endpoint per rank query and
-- records where the brand's domain appears in the results. Off by default
-- so existing paying customers are unaffected (no extra Firecrawl calls,
-- no behavior change) until explicitly enabled per subscription.
--
--   * track_rank   — enable the rank check for this subscription.
--   * rank_queries — keyword queries to rank for (jsonb string[]). When
--                    NULL, the run falls back to the subscription's prompts.
--
-- Additive only. Safe to apply against prod.

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS track_rank boolean NOT NULL DEFAULT false;

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS rank_queries jsonb;
