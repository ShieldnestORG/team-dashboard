-- Allow multiple X accounts per company (e.g. primary + coherencedaddy)
ALTER TABLE x_oauth_tokens
  ADD COLUMN IF NOT EXISTS account_slug TEXT NOT NULL DEFAULT 'primary';

-- Drop old single-account unique constraint
ALTER TABLE x_oauth_tokens
  DROP CONSTRAINT IF EXISTS x_oauth_tokens_company_id_uq;

-- Add composite unique: one token set per (company, account)
ALTER TABLE x_oauth_tokens
  ADD CONSTRAINT x_oauth_tokens_company_account_uq UNIQUE (company_id, account_slug);

CREATE INDEX IF NOT EXISTS idx_x_oauth_tokens_account_slug ON x_oauth_tokens(account_slug);

ALTER TABLE auto_reply_config
  ADD COLUMN IF NOT EXISTS x_account_slug TEXT NOT NULL DEFAULT 'primary';
