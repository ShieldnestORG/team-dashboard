-- Shop sharers — email-capture entity for shop.coherencedaddy.com.
-- A "sharer" is anyone who drops their email on the shop and receives a
-- referral code + QR + shareable link. Sharers may opt into the existing
-- affiliate program; approval promotes them to an `affiliates` row.
-- See docs/products/shop-sharers.md.

CREATE TABLE IF NOT EXISTS shop_sharers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  qr_object_key TEXT,
  landing_path TEXT NOT NULL DEFAULT '/shop-home',
  affiliate_application_status TEXT,
  affiliate_id UUID REFERENCES affiliates(id),
  shared_marketing_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'shop_hero',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_sharers_email_uq ON shop_sharers (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS shop_sharers_referral_code_uq ON shop_sharers (referral_code);
CREATE INDEX IF NOT EXISTS shop_sharers_status_idx ON shop_sharers (affiliate_application_status);

-- Referral attribution for unauthenticated shop traffic.
-- Hit events are written by a public beacon when ?ref=<code> appears on
-- any shop.coherencedaddy.com URL. Purchase events are out of scope this
-- round but share the same table shape.
CREATE TABLE IF NOT EXISTS shop_referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sharer_id UUID NOT NULL REFERENCES shop_sharers(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'hit' | 'purchase' (future)
  path TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  amount_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shop_referral_events_sharer_idx ON shop_referral_events (sharer_id);
CREATE INDEX IF NOT EXISTS shop_referral_events_code_created_idx ON shop_referral_events (referral_code, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_referral_events_type_idx ON shop_referral_events (event_type);
