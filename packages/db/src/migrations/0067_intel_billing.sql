-- Intel API paid tier — plans, customers, API keys, usage meter.
-- Self-serve via Stripe Checkout; metered overage reported daily.

CREATE TABLE IF NOT EXISTS intel_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  stripe_price_id TEXT,
  stripe_metered_price_id TEXT,
  monthly_request_quota BIGINT NOT NULL DEFAULT 0,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  overage_price_cents_per_1k INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intel_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_item_id TEXT,
  plan_id UUID REFERENCES intel_plans(id),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intel_customers_stripe_customer
  ON intel_customers (stripe_customer_id);

CREATE TABLE IF NOT EXISTS intel_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES intel_customers(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT 'default',
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intel_api_keys_customer
  ON intel_api_keys (customer_id);

CREATE TABLE IF NOT EXISTS intel_usage_meter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES intel_api_keys(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  overage_count BIGINT NOT NULL DEFAULT 0,
  overage_reported_to_stripe_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intel_usage_meter_key_period
  ON intel_usage_meter (api_key_id, period_start);

-- Seed four tiers. Stripe price IDs populated later via env/admin.
INSERT INTO intel_plans (slug, name, monthly_request_quota, rate_limit_per_min, overage_price_cents_per_1k, price_cents)
VALUES
  ('free',       'Free',       1000,     60,   0,  0),
  ('starter',    'Starter',    100000,   300,  10, 1900),
  ('pro',        'Pro',        500000,   1000, 5,  4900),
  ('enterprise', 'Enterprise', 5000000,  5000, 3,  19900)
ON CONFLICT (slug) DO NOTHING;
