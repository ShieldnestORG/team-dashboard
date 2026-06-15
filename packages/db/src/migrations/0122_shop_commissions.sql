-- Shop commissions — lightweight payout ledger for shop/influencer referral
-- sales, intentionally decoupled from the B2B affiliate commission engine
-- (commissions/payouts, which are keyed off SaaS subscriptions + clawback/tier
-- logic). A row is created when a paid WooCommerce order carrying a ?ref=
-- attribution is reported to POST /api/shop/woo/order.
-- See docs/products/affiliate-unified-links.md (Phase 3).

CREATE TABLE IF NOT EXISTS shop_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sharer_id UUID NOT NULL REFERENCES shop_sharers(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  referral_event_id UUID REFERENCES shop_referral_events(id) ON DELETE SET NULL,
  order_ref TEXT NOT NULL,                -- external (Woo) order id; idempotency key
  gross_amount_cents INTEGER NOT NULL,
  rate NUMERIC(5,4) NOT NULL,             -- snapshot of the rate applied
  commission_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | paid | void
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_commissions_order_ref_uq ON shop_commissions (order_ref);
CREATE INDEX IF NOT EXISTS shop_commissions_sharer_idx ON shop_commissions (sharer_id);
CREATE INDEX IF NOT EXISTS shop_commissions_status_idx ON shop_commissions (status);
