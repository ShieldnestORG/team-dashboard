-- 0083 — Affiliate Phase 2: commission ledger + payout batches
-- Additive + idempotent. Applied to prod Neon via psql.

-- affiliates extensions
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS payout_method text;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS payout_account text;
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS minimum_payout_cents integer NOT NULL DEFAULT 5000;

-- payouts table (created first — commissions FKs into it)
CREATE TABLE IF NOT EXISTS payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  amount_cents integer NOT NULL,
  commission_count integer NOT NULL,
  method text NOT NULL DEFAULT 'manual_ach',
  external_id text,
  status text NOT NULL DEFAULT 'scheduled',
  batch_month text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payouts_affiliate_batch_uq ON payouts (affiliate_id, batch_month);
CREATE INDEX IF NOT EXISTS payouts_status_idx ON payouts (status);
CREATE INDEX IF NOT EXISTS payouts_scheduled_for_idx ON payouts (scheduled_for);

-- commissions table
CREATE TABLE IF NOT EXISTS commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(id),
  lead_id uuid NOT NULL REFERENCES partner_companies(id),
  attribution_id uuid NOT NULL REFERENCES referral_attribution(id),
  type text NOT NULL,
  rate numeric(5,4) NOT NULL,
  amount_cents integer NOT NULL,
  basis_cents integer NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_activation',
  stripe_invoice_id text,
  stripe_charge_id text,
  hold_expires_at timestamptz,
  payout_batch_id uuid REFERENCES payouts(id),
  clawback_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commissions_affiliate_status_idx ON commissions (affiliate_id, status);
CREATE INDEX IF NOT EXISTS commissions_lead_idx ON commissions (lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS commissions_stripe_invoice_uq
  ON commissions (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commissions_hold_expires_idx
  ON commissions (hold_expires_at) WHERE status = 'pending_activation';
CREATE INDEX IF NOT EXISTS commissions_payout_batch_idx ON commissions (payout_batch_id);
