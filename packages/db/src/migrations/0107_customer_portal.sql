-- 0107_customer_portal.sql
-- Customer Portal MVP — accounts, magic-link auth, encrypted credentials, and
-- an action audit log. This is the first piece of customer-facing
-- infrastructure inside team-dashboard; everything before it has been
-- internal admin (board) auth or product-level subscription state.
--
-- Non-goals (intentionally out of scope here):
--   * No password storage. Auth is magic-link only for V1. The HMAC-signed
--     session cookie issued on link consumption is the only credential.
--   * No company tenancy / RBAC. A customer_account is a leaf actor that
--     resolves to whatever subscription rows match its email. Multi-tenant
--     workspaces are a future migration.
--   * No webhook receiver for credential rotation. Customers manage their
--     own credentials via the portal UI; we soft-revoke on delete.
--
-- Encrypted_value column stores the JSON envelope from the local-encrypted
-- secrets provider (`{ scheme, iv, tag, ciphertext }`, base64). We do NOT
-- roll new crypto here — see server/src/secrets/local-encrypted-provider.ts.
--
-- Per CLAUDE.md: this migration MUST be applied to prod Neon manually after
-- a feature-branch merge; the orchestrator handles the production cutover.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS customer_accounts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext      NOT NULL UNIQUE,
  stripe_customer_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_login_at      timestamptz
);

CREATE INDEX IF NOT EXISTS customer_accounts_stripe_customer_idx
  ON customer_accounts (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_magic_links (
  token       text        PRIMARY KEY,
  email       citext      NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_magic_links_email_expires_idx
  ON customer_magic_links (email, expires_at);

CREATE INDEX IF NOT EXISTS customer_magic_links_consumed_idx
  ON customer_magic_links (consumed_at);

CREATE TABLE IF NOT EXISTS customer_credentials (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  kind            text        NOT NULL CHECK (
                    kind IN ('cloudflare_api_token','reddit_oauth','x_oauth','ga4_property')
                  ),
  encrypted_value text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

-- One active credential per (account, kind). Revoked rows are kept for audit.
CREATE UNIQUE INDEX IF NOT EXISTS customer_credentials_active_uq
  ON customer_credentials (account_id, kind)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS customer_credentials_account_idx
  ON customer_credentials (account_id);

CREATE TABLE IF NOT EXISTS customer_action_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        REFERENCES customer_accounts(id) ON DELETE SET NULL,
  kind       text        NOT NULL,
  payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_action_log_account_created_idx
  ON customer_action_log (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_action_log_kind_idx
  ON customer_action_log (kind);

COMMENT ON TABLE customer_accounts IS
  'Customer Portal MVP — leaf actor identity (email-only). Resolves to subscription rows by email. Created on first magic-link consumption.';

COMMENT ON TABLE customer_magic_links IS
  'Single-use magic links for passwordless customer auth. 15-min default TTL via PORTAL_MAGIC_LINK_TTL_MIN. Token is the PK (already random + opaque).';

COMMENT ON TABLE customer_credentials IS
  'Per-account third-party credentials (Cloudflare, Reddit, X, GA4). Encrypted via local-encrypted secrets provider. Soft-revoke; never plaintext through the API.';

COMMENT ON TABLE customer_action_log IS
  'Append-only audit trail of customer-portal actions (login, credential add/revoke, stripe-portal redirect, etc.). Never log secret values.';
