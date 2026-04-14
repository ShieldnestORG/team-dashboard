-- Directory Featured Listings — monetization layer on top of intel_companies.
-- Sells "featured / verified / boosted" placement on directory.coherencedaddy.com
-- via Stripe Checkout + recurring subscriptions. Tracks contact info for sales
-- outreach + the full lifecycle of a listing (prospect -> paid -> expired).

-- ---------------------------------------------------------------------------
-- 1. Contact info columns on intel_companies (for sales outreach)
-- ---------------------------------------------------------------------------
ALTER TABLE intel_companies
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_notes TEXT,
  ADD COLUMN IF NOT EXISTS contact_source TEXT,
  ADD COLUMN IF NOT EXISTS contact_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS intel_companies_contact_email_idx
  ON intel_companies (contact_email);

-- ---------------------------------------------------------------------------
-- 2. Directory listings table (one row per listing lifecycle)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directory_listings (
  id                          SERIAL PRIMARY KEY,
  company_id                  INTEGER NOT NULL REFERENCES intel_companies(id) ON DELETE CASCADE,
  tier                        TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'prospect',
  monthly_price_cents         INTEGER NOT NULL,
  currency                    TEXT NOT NULL DEFAULT 'usd',
  stripe_customer_id          TEXT,
  stripe_subscription_id      TEXT,
  stripe_checkout_session_id  TEXT,
  stripe_price_id             TEXT,
  checkout_url                TEXT,
  started_at                  TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  canceled_at                 TIMESTAMPTZ,
  last_outreach_at            TIMESTAMPTZ,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS directory_listings_company_idx
  ON directory_listings (company_id);
CREATE INDEX IF NOT EXISTS directory_listings_status_idx
  ON directory_listings (status);
CREATE UNIQUE INDEX IF NOT EXISTS directory_listings_stripe_sub_uq
  ON directory_listings (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS directory_listings_active_unique
  ON directory_listings (company_id)
  WHERE status IN ('active', 'past_due');

-- ---------------------------------------------------------------------------
-- 3. Audit log for status transitions + webhook events + outreach + notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directory_listing_events (
  id          SERIAL PRIMARY KEY,
  listing_id  INTEGER REFERENCES directory_listings(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS directory_listing_events_listing_idx
  ON directory_listing_events (listing_id);
CREATE INDEX IF NOT EXISTS directory_listing_events_created_idx
  ON directory_listing_events (created_at DESC);
