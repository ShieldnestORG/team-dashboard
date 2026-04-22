-- CreditScore product — plan catalog, per-customer subscriptions, stored reports.
-- See docs/products/creditscore-prd.md for the product spec.

CREATE TABLE IF NOT EXISTS creditscore_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  billing_interval TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stripe_price_id TEXT,
  entitlements JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creditscore_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  email TEXT,
  domain TEXT,
  plan_id UUID NOT NULL REFERENCES creditscore_plans(id),
  tier TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditscore_subscriptions_company_idx ON creditscore_subscriptions (company_id);
CREATE INDEX IF NOT EXISTS creditscore_subscriptions_email_idx ON creditscore_subscriptions (email);
CREATE INDEX IF NOT EXISTS creditscore_subscriptions_domain_idx ON creditscore_subscriptions (domain);
CREATE INDEX IF NOT EXISTS creditscore_subscriptions_status_idx ON creditscore_subscriptions (status);
CREATE UNIQUE INDEX IF NOT EXISTS creditscore_subscriptions_stripe_sub_idx ON creditscore_subscriptions (stripe_subscription_id);

CREATE TABLE IF NOT EXISTS creditscore_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES creditscore_subscriptions(id) ON DELETE SET NULL,
  domain TEXT NOT NULL,
  email TEXT,
  result_json JSONB NOT NULL DEFAULT '{}',
  score INTEGER,
  previous_score INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  shareable_slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditscore_reports_subscription_idx ON creditscore_reports (subscription_id);
CREATE INDEX IF NOT EXISTS creditscore_reports_domain_idx ON creditscore_reports (domain);
CREATE INDEX IF NOT EXISTS creditscore_reports_status_idx ON creditscore_reports (status);
CREATE UNIQUE INDEX IF NOT EXISTS creditscore_reports_shareable_slug_idx ON creditscore_reports (shareable_slug);

-- Seed the 5 plan rows at the locked pricing. stripe_price_id values were
-- created manually in the Stripe dashboard (see PRD §Stripe Products to Create
-- and the Phase 1.5 handoff brief).
INSERT INTO creditscore_plans (slug, name, tier, billing_interval, price_cents, stripe_price_id, entitlements) VALUES
  (
    'report_onetime',
    'One-Time Report',
    'report',
    'one_time',
    1900,
    'price_1TOumIQwTOfgszhyP5sAwCbU',
    '{"oneTimeReport": true}'::jsonb
  ),
  (
    'starter_monthly',
    'Starter',
    'starter',
    'monthly',
    4900,
    'price_1TOumJQwTOfgszhyqGiTpZmW',
    '{"domains": 1, "rescanCadence": "monthly", "alertThreshold": 10}'::jsonb
  ),
  (
    'growth_monthly',
    'Growth',
    'growth',
    'monthly',
    19900,
    'price_1TOumKQwTOfgszhyXfwrSKpX',
    '{"domains": 1, "rescanCadence": "monthly", "aiPagesPerMonth": 2, "schemaImplsPerMonth": 1, "competitorDomains": 3}'::jsonb
  ),
  (
    'growth_annual',
    'Growth (Annual)',
    'growth',
    'annual',
    118800,
    'price_1TOumLQwTOfgszhy9zFtD7Iz',
    '{"domains": 1, "rescanCadence": "monthly", "aiPagesPerMonth": 2, "schemaImplsPerMonth": 1, "competitorDomains": 3}'::jsonb
  ),
  (
    'pro_monthly',
    'Pro',
    'pro',
    'monthly',
    49900,
    'price_1TOumMQwTOfgszhylFKsIBci',
    '{"domains": 1, "rescanCadence": "weekly", "aiPagesPerMonth": 4, "schemaImplsPerMonth": 2, "competitorDomains": 5, "dedicatedStrategist": true}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;
