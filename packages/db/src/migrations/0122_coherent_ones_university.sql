-- 0122_coherent_ones_university.sql
-- Coherent Ones University — $50/mo recurring membership.
--
-- A University member is its OWN member class, not just an access flag bolted
-- onto an existing customer/affiliate account. We model it as a real member
-- entity while REUSING the existing magic-link auth (customer_accounts is the
-- shared login identity, joined on the lowercased email) and the existing
-- Stripe pipeline. Two tables:
--
--   university_members        — the member entity / profile. The join key is
--                               the lowercased `email` (unique). `account_id`
--                               links to customer_accounts once the
--                               customer-account-linker resolves the login
--                               identity.
--   university_subscriptions  — the Stripe billing record. Idempotency key is
--                               `stripe_subscription_id` (UNIQUE) — a replayed
--                               checkout updates the row in place.
--
-- The Stripe webhook handler (services/university-stripe-handler.ts):
--   - checkout.session.completed → links customer→account, upserts the
--     subscription idempotently on stripe_subscription_id, and upserts the
--     member (status active, joined_at set).
--   - customer.subscription.updated → mirror Stripe status onto both rows.
--   - customer.subscription.deleted → status='cancelled' on both rows.
--
-- Mirrors the single-tier $X/mo Watchtower template (see 0109_watchtower.sql
-- and 0111_watchtower_stripe_columns.sql).
--
-- Additive only: 2 tables + 5 indexes. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS university_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                                -- lowercased join key (unique below)
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','past_due','cancelled')),
  plan TEXT NOT NULL DEFAULT 'university_monthly',
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS university_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES university_members(id),  -- nullable; checkout may race ahead of member creation
  account_id UUID,
  email TEXT,
  plan TEXT DEFAULT 'university_monthly',
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','active','past_due','cancelled')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,                        -- idempotency key (unique below)
  stripe_checkout_session_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One member per email — the durable join key into customer_accounts.
CREATE UNIQUE INDEX IF NOT EXISTS university_members_email_key
  ON university_members (email);

CREATE INDEX IF NOT EXISTS university_members_account_idx
  ON university_members (account_id);

CREATE INDEX IF NOT EXISTS university_members_status_idx
  ON university_members (status);

-- Idempotency: a replayed Stripe checkout updates the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS university_subscriptions_stripe_sub_uq
  ON university_subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS university_subscriptions_email_idx
  ON university_subscriptions (email);

CREATE INDEX IF NOT EXISTS university_subscriptions_stripe_cust_idx
  ON university_subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS university_subscriptions_status_idx
  ON university_subscriptions (status);
