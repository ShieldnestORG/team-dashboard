ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS reset_token              TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS affiliates_reset_token_idx
  ON affiliates (reset_token) WHERE reset_token IS NOT NULL;
