-- CreditScore comp grants: track admin-issued free subscriptions.
-- comp_reason is set when an admin gives away the product (promo, friend, support credit, etc.).
-- grantedBy_user_id captures which board user issued the grant.

ALTER TABLE creditscore_subscriptions
  ADD COLUMN IF NOT EXISTS comp_reason TEXT;

ALTER TABLE creditscore_subscriptions
  ADD COLUMN IF NOT EXISTS granted_by_user_id UUID;

CREATE INDEX IF NOT EXISTS creditscore_subscriptions_comp_reason_idx
  ON creditscore_subscriptions (comp_reason)
  WHERE comp_reason IS NOT NULL;
