-- 0111_watchtower_stripe_columns.sql
-- Watchtower Stripe wiring: columns + status check loosening.
--
-- Adds the columns the Stripe webhook handler needs:
--   - stripe_customer_id  → set on checkout.session.completed; lets us
--                            map a subscription back to customer_accounts
--                            via customer-account-linker.
--   - plan                → currently single-tier ('watchtower_monthly');
--                            keeps room for a future daily upsell tier
--                            without another migration.
--   - email               → captured at checkout time; used as the digest
--                            recipient until per-account email lookup ships
--                            (see open follow-up #1 in docs/products/watchtower.md).
--
-- Loosens the status CHECK constraint to include 'past_due' so the Stripe
-- subscription.updated handler can mirror Stripe's status verbatim
-- (active | past_due | paused | cancelled).
--
-- Additive only. Safe to apply against prod.

ALTER TABLE watchtower_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'watchtower_monthly',
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE watchtower_subscriptions
  DROP CONSTRAINT IF EXISTS watchtower_subscriptions_status_check;

ALTER TABLE watchtower_subscriptions
  ADD CONSTRAINT watchtower_subscriptions_status_check
  CHECK (status IN ('active','paused','past_due','cancelled'));

CREATE INDEX IF NOT EXISTS watchtower_subscriptions_stripe_sub_idx
  ON watchtower_subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS watchtower_subscriptions_stripe_cust_idx
  ON watchtower_subscriptions (stripe_customer_id);
