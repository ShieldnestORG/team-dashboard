CREATE TABLE affiliates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  total_earned    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX affiliates_email_uq ON affiliates (lower(email));
CREATE INDEX affiliates_status_idx ON affiliates (status);

ALTER TABLE partner_companies
  ADD COLUMN IF NOT EXISTS affiliate_id    UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS affiliate_notes TEXT,
  ADD COLUMN IF NOT EXISTS store_notes     TEXT;

CREATE INDEX IF NOT EXISTS partner_companies_affiliate_idx
  ON partner_companies (affiliate_id) WHERE affiliate_id IS NOT NULL;
