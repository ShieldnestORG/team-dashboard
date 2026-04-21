-- 0085 — Affiliate Phase 4: engagement + tiers + compliance + merch
-- Additive + idempotent. Applied to prod Neon via psql.

-- affiliates: tier + compliance + engagement columns
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'bronze';
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS tier_upgraded_at timestamptz;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS violation_count integer NOT NULL DEFAULT 0;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS suspension_reason text;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS promo_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS last_lead_submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS affiliates_tier_idx ON affiliates (tier);
CREATE INDEX IF NOT EXISTS affiliates_suspended_idx ON affiliates (suspended_at);

-- affiliate_tiers: config table
CREATE TABLE IF NOT EXISTS affiliate_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  display_order integer NOT NULL,
  commission_rate numeric(5, 4) NOT NULL,
  min_lifetime_cents integer NOT NULL,
  min_active_partners integer NOT NULL DEFAULT 0,
  perks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_tiers_name_uq ON affiliate_tiers (name);

INSERT INTO affiliate_tiers (name, display_order, commission_rate, min_lifetime_cents, min_active_partners, perks)
VALUES
  ('bronze',   1, 0.10, 0,       0,  '["Welcome kit"]'::jsonb),
  ('silver',   2, 0.12, 100000,  3,  '["Welcome kit","Starter shirt"]'::jsonb),
  ('gold',     3, 0.15, 500000,  10, '["Welcome kit","Starter shirt","Priority support"]'::jsonb),
  ('platinum', 4, 0.20, 2000000, 25, '["Welcome kit","Starter shirt","Priority support","Annual event invite"]'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- promo_campaigns
CREATE TABLE IF NOT EXISTS promo_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  hashtag text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  giveaway_prize text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promo_campaigns_status_idx ON promo_campaigns (status);

-- affiliate_engagement
CREATE TABLE IF NOT EXISTS affiliate_engagement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  campaign_id uuid REFERENCES promo_campaigns(id),
  kind text NOT NULL,
  post_url text,
  hashtag_used text,
  score integer NOT NULL DEFAULT 0,
  giveaway_eligible boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_engagement_affiliate_occurred_idx
  ON affiliate_engagement (affiliate_id, occurred_at);
CREATE INDEX IF NOT EXISTS affiliate_engagement_kind_idx
  ON affiliate_engagement (kind);
CREATE INDEX IF NOT EXISTS affiliate_engagement_campaign_idx
  ON affiliate_engagement (campaign_id);

-- affiliate_violations
CREATE TABLE IF NOT EXISTS affiliate_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  lead_id uuid REFERENCES partner_companies(id),
  detection_type text NOT NULL,
  rule_code text NOT NULL,
  severity text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',
  commissions_clawed_back integer NOT NULL DEFAULT 0,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_violations_affiliate_status_idx
  ON affiliate_violations (affiliate_id, status);
CREATE INDEX IF NOT EXISTS affiliate_violations_severity_idx
  ON affiliate_violations (severity);

-- merch_requests
CREATE TABLE IF NOT EXISTS merch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  item_type text NOT NULL,
  size_or_variant text,
  shipping_address jsonb NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  tracking_number text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merch_requests_affiliate_status_idx
  ON merch_requests (affiliate_id, status);

-- leaderboard_snapshots
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,
  rank integer NOT NULL,
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  score numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leaderboard_snapshots_period_rank_idx
  ON leaderboard_snapshots (period, rank);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_affiliate_idx
  ON leaderboard_snapshots (affiliate_id);
