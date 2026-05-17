-- 0116_admin_impersonation.sql
-- Admin-to-customer impersonation flow (audit V2 blocker #1).
--
-- Implements the "View as <customer>" handoff from the watchtower admin
-- surface (team-dashboard) to the customer portal SPA. The admin clicks
-- the button; backend mints a single-use, 5-minute, DB-tracked nonce; the
-- portal calls /api/portal/admin-impersonate with the nonce; backend
-- atomically burns the nonce and issues a 60-minute impersonation cookie
-- (`cd_portal_impersonation`, distinct from `cd_portal_session`).
--
-- This table tracks ONLY the short-lived nonces. The 60-minute session
-- itself is an HMAC-signed token (no row needed); duration is reconstructed
-- from the started_at claim baked into the token. activity_log carries the
-- audit trail (`admin.impersonate.start` / `admin.impersonate.end`).
--
-- Why a DB row for the nonce (instead of, say, a JWT)?
--   1. Single-use is a hard requirement. JWTs are stateless and cannot be
--      "burned" without a side table — so the side table IS the truth.
--   2. We get the audit (who minted, who exchanged, when) for free.
--
-- Why a JWT cookie for the 60-min session (instead of a row)?
--   1. No revocation requirement in V1 — admin closes browser, session
--      lapses on its own at 60 min.
--   2. Mirrors the existing `cd_portal_session` HMAC-cookie pattern.
--   3. Avoids a second insert on every page load.
--   We can add a `admin_impersonation_sessions` table later if we ever
--   need active-session revocation; the token format already carries a
--   session id (sid) so a future revocation list joins cleanly.

CREATE TABLE IF NOT EXISTS admin_impersonation_nonces (
  nonce                  text        PRIMARY KEY,
  admin_actor_id         uuid        NOT NULL,
  admin_actor_label      text,
  target_account_id      uuid        NOT NULL,
  target_customer_label  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  burned_at              timestamptz
);

-- Drives the cleanup cron (future); also keeps lookups by nonce fast via the
-- PK index. The expires_at index is a small win for "find all expired" sweeps.
CREATE INDEX IF NOT EXISTS admin_impersonation_nonces_expires_idx
  ON admin_impersonation_nonces (expires_at);

CREATE INDEX IF NOT EXISTS admin_impersonation_nonces_target_idx
  ON admin_impersonation_nonces (target_account_id);

COMMENT ON TABLE admin_impersonation_nonces IS
  'Single-use 5-minute nonces for the "View as customer" handoff. Burned atomically on first exchange. The 60-min impersonation session itself is a JWT/HMAC cookie — no row.';
