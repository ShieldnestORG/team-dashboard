-- Bundle packages — plan definitions and per-company subscriptions.
-- One Stripe subscription grants access to multiple product entitlements.

CREATE TABLE IF NOT EXISTS bundle_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  annual_price_cents INTEGER NOT NULL,
  stripe_price_id TEXT,
  stripe_annual_price_id TEXT,
  entitlements JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bundle_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  bundle_plan_id UUID NOT NULL REFERENCES bundle_plans(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  billing_interval TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'pending',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bundle_subscriptions_company_idx ON bundle_subscriptions (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS bundle_subscriptions_stripe_sub_idx ON bundle_subscriptions (stripe_subscription_id);

-- Seed the three bundle plans.
INSERT INTO bundle_plans (slug, name, price_cents, annual_price_cents, entitlements) VALUES
  (
    'aeo_starter',
    'AEO Starter',
    19900,
    15900,
    '{
      "creditscore": {"tier": "starter", "domains": 1},
      "directoryListing": {"tier": "featured"},
      "partnerNetwork": {"tier": "proof"},
      "intelApi": null
    }'::jsonb
  ),
  (
    'aeo_growth',
    'AEO Growth',
    49900,
    39900,
    '{
      "creditscore": {"tier": "pro", "domains": 1},
      "directoryListing": {"tier": "verified"},
      "partnerNetwork": {"tier": "performance"},
      "intelApi": null
    }'::jsonb
  ),
  (
    'aeo_scale',
    'AEO Scale',
    129900,
    104900,
    '{
      "creditscore": {"tier": "pro", "domains": 1},
      "directoryListing": {"tier": "boosted"},
      "partnerNetwork": {"tier": "premium"},
      "intelApi": {"planSlug": "pro"}
    }'::jsonb
  ),
  (
    'all_inclusive',
    'All-Inclusive',
    249900,
    249900,
    '{
      "creditscore": {"tier": "pro", "domains": 3},
      "directoryListing": {"tier": "boosted"},
      "partnerNetwork": {"tier": "premium"},
      "intelApi": {"planSlug": "enterprise"},
      "allInclusive": true
    }'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;
