-- 0139_watchtower_performance.sql
-- Adds opt-in GA4 traffic + Google Ads spend tracking to Watchtower
-- subscriptions, powering a new "Performance" section in the weekly digest.
--
-- Watchtower v1 measures AEO/GEO (AI-engine brand mentions) and, since
-- migration 0119, classical Google rank. This adds two more business signals,
-- both opt-in and off by default so existing paying customers are unaffected
-- (no extra GA4/Ads API calls, no behavior change) until explicitly enabled
-- per subscription — mirroring the track_rank pattern.
--
--   * track_ga4              — enable the GA4 traffic pull for this subscription.
--   * ga4_property_id        — the GA4 property id (e.g. "123456789") to query.
--   * track_ads             — enable the Google Ads spend pull.
--   * google_ads_customer_id — the Ads customer id (no dashes) to query.
--
-- Additive only. Safe to apply against prod.

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS track_ga4 boolean NOT NULL DEFAULT false;

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS ga4_property_id text;

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS track_ads boolean NOT NULL DEFAULT false;

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS google_ads_customer_id text;
