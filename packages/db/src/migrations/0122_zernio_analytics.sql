-- 0122_zernio_analytics.sql
-- Storage for Zernio social analytics (Goal B).
--
-- Zernio is the multi-account publish path already used across the socials hub
-- (see services/platform-publishers/zernio.ts). This migration adds the two
-- tables the analytics poller writes and the read API serves FROM (the API does
-- NOT hit live Zernio on every request — the zernio:analytics-poller cron, every
-- 6h, UPSERTs into these):
--   * zernio_post_analytics    — one row per (zernio account, platform post).
--   * zernio_account_analytics — one row per (zernio account, as-of date).
--
-- The Zernio account id is NOT a dedicated column on social_accounts; it lives in
-- social_accounts.oauth_ref as "zernio:<id>". We denormalise both the
-- team-dashboard social_account_id (FK) and the derived zernio_account_id (TEXT)
-- onto every row so reads can group by either without re-parsing oauth_ref.
--
-- Additive only. Idempotent. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS zernio_post_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id UUID NOT NULL REFERENCES companies(id),
  -- The team-dashboard social_accounts row this post belongs to.
  social_account_id UUID NOT NULL REFERENCES social_accounts(id),
  -- Derived from social_accounts.oauth_ref ("zernio:<id>"). Denormalised so the
  -- poller can UPSERT and reads can group without re-parsing oauth_ref.
  zernio_account_id TEXT NOT NULL,
  -- Zernio platform string ("instagram" | "tiktok" | "youtube" | "twitter").
  platform TEXT NOT NULL,

  -- Zernio's own post id; the on-platform post id + public URL it reconciled.
  zernio_post_id TEXT,
  platform_post_id TEXT,
  platform_post_url TEXT,
  content_preview TEXT,

  published_at TIMESTAMPTZ,

  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  saves INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  -- Stored as text-numeric (drizzle `numeric`) so a rate like 0.0425 keeps
  -- precision; read API parses to number.
  engagement_rate NUMERIC NOT NULL DEFAULT 0,
  reels_avg_watch_time INTEGER NOT NULL DEFAULT 0,

  last_synced_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent UPSERT target for the poller: one row per (zernio account, post).
-- platform_post_id is the stable on-platform id Zernio reconciled.
CREATE UNIQUE INDEX IF NOT EXISTS zernio_post_analytics_account_post_uq
  ON zernio_post_analytics(zernio_account_id, platform_post_id);

-- Per-account post listing + recency ordering (read API: recentPosts).
CREATE INDEX IF NOT EXISTS zernio_post_analytics_account_published_idx
  ON zernio_post_analytics(social_account_id, published_at);

-- Company-wide rollups (read API: overview totals).
CREATE INDEX IF NOT EXISTS zernio_post_analytics_company_published_idx
  ON zernio_post_analytics(company_id, published_at);


CREATE TABLE IF NOT EXISTS zernio_account_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id UUID NOT NULL REFERENCES companies(id),
  social_account_id UUID NOT NULL REFERENCES social_accounts(id),
  zernio_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,

  -- The day this account snapshot describes (one snapshot per account per day).
  as_of_date DATE NOT NULL,

  reach INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  accounts_engaged INTEGER NOT NULL DEFAULT 0,
  total_interactions INTEGER NOT NULL DEFAULT 0,
  followers INTEGER NOT NULL DEFAULT 0,
  profile_links_taps INTEGER NOT NULL DEFAULT 0,

  -- The reporting window the upstream insights covered for this snapshot.
  window_start DATE,
  window_end DATE,

  last_synced_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent UPSERT target: one snapshot per (zernio account, day). A re-poll on
-- the same day overwrites the day's row with fresher numbers.
CREATE UNIQUE INDEX IF NOT EXISTS zernio_account_analytics_account_date_uq
  ON zernio_account_analytics(zernio_account_id, as_of_date);

-- Follower-history / per-account time series (read API: followerHistory).
CREATE INDEX IF NOT EXISTS zernio_account_analytics_account_date_idx
  ON zernio_account_analytics(social_account_id, as_of_date);

-- Company-wide latest-snapshot rollups (read API: overview followers/reach).
CREATE INDEX IF NOT EXISTS zernio_account_analytics_company_date_idx
  ON zernio_account_analytics(company_id, as_of_date);
