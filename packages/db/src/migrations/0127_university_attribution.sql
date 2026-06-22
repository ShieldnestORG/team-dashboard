-- 0127_university_attribution.sql
-- Coherent Ones University — ad/marketing attribution. Captures the click ids
-- (fbclid/fbc/fbp/ttclid/gclid), UTM params, and landing/referrer context that
-- arrive on a checkout so paid acquisition can be measured and so Meta CAPI /
-- TikTok Events can be fired server-side on purchase + renewal + refund.
--
-- The ad params are carried in the Stripe Checkout Session METADATA (never
-- client_reference_id — the referral branch owns that for its `ref` code).
--
-- One attribution row PER lead, keyed on the lowercased `email` (the same
-- durable identity the rest of University uses). The webhook upserts this row
-- ON CONFLICT (email): `first_touch_at` is stamped on the FIRST insert and is
-- IMMUTABLE; `last_touch_at` refreshes every touch and newly-present click ids /
-- stripe ids are filled in. At checkout completion the Stripe customer +
-- subscription are stamped so renewals stay attributed.
--
-- A SEPARATE small `university_attribution_events` table (UNIQUE on the Stripe
-- `event.id`) is the replay / idempotency guard so CAPI/TikTok never double-fire
-- when Stripe redelivers an event.
--
-- Also stamps `utm_campaign` + `utm_source` onto `university_subscriptions` so a
-- renewal event (which carries no checkout metadata) can still be attributed to
-- the originating campaign.
--
-- Mirrors the 0123 table/index style. Additive only: 2 tables + 5 indexes
-- (2 unique) + 2 nullable columns. Re-runnable. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS university_attribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable join key — one row per lead
  fbclid TEXT,
  fbc TEXT,
  fbp TEXT,
  ttclid TEXT,
  gclid TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  landing_url TEXT,
  referrer TEXT,
  first_touch_at TIMESTAMPTZ,                        -- immutable; set on first insert only
  last_touch_at TIMESTAMPTZ,                         -- refreshed each touch
  stripe_customer_id TEXT,
  subscription_id UUID REFERENCES university_subscriptions(id),  -- nullable; checkout may race the sub
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One attribution row per lead. An upsert keys on the durable email identity
-- (ON CONFLICT in the service) so it holds before the account link resolves.
CREATE UNIQUE INDEX IF NOT EXISTS university_attribution_email_key
  ON university_attribution (email);

CREATE INDEX IF NOT EXISTS university_attribution_stripe_cust_idx
  ON university_attribution (stripe_customer_id);

CREATE INDEX IF NOT EXISTS university_attribution_subscription_idx
  ON university_attribution (subscription_id);

CREATE INDEX IF NOT EXISTS university_attribution_account_idx
  ON university_attribution (account_id);

-- Idempotency / replay guard for the webhook side-effects (Meta CAPI + TikTok
-- Events). Stripe redelivers the same event.id on retries; an INSERT ... ON
-- CONFLICT (stripe_event_id) DO NOTHING that affects 0 rows means the event was
-- already processed → the webhook returns early so CAPI/TikTok never re-fire.
CREATE TABLE IF NOT EXISTS university_attribution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL,                     -- natural idempotency / replay key
  event_type TEXT NOT NULL,
  email TEXT,
  stripe_customer_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS university_attribution_events_stripe_event_key
  ON university_attribution_events (stripe_event_id);

-- Stamp the originating campaign onto the billing row so renewal events (which
-- carry no checkout metadata) stay attributed. Written by the ad-attribution
-- webhook hook, not the shared checkout handler. Additive + nullable.
ALTER TABLE university_subscriptions ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE university_subscriptions ADD COLUMN IF NOT EXISTS utm_source TEXT;
