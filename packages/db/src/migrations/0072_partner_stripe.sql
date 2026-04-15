-- Partner Network — Stripe billing columns.
-- Adds subscription tracking fields to partner_companies so we can
-- collect recurring payments via Stripe Checkout for proof / performance / premium tiers.

ALTER TABLE partner_companies
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id          TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS current_period_end       TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS partner_companies_stripe_sub_uq
  ON partner_companies (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS partner_companies_subscription_status_idx
  ON partner_companies (subscription_status);
