-- 0144_intel_billing_idempotency.sql
-- Idempotency for Intel API key provisioning (security remediation — High #6).
-- (Renumbered 0142 → 0144 after rebase: 0142/0143 were taken by the University
-- email-analytics migrations that landed on master in parallel.)
--
-- provisionFromCheckout() runs on every `checkout.session.completed` delivery.
-- Stripe re-delivers webhooks (and a replayed valid signed event is accepted by
-- the signature check), so without a dedup guard each delivery minted a NEW
-- intel_api_keys row and emailed a fresh raw key — N live keys + N emails per
-- purchase.
--
-- Fix: record the originating Stripe checkout session id on the minted key and
-- make it UNIQUE. The service checks for an existing key for the session before
-- minting (select-existing-first — mirrors university-referrals'
-- applyCreditForPayer idempotency style), and the UNIQUE index is the race
-- backstop so a concurrent replay can't slip a second key past the check.
--
-- Nullable so pre-existing keys (minted before this column) stay valid; the
-- UNIQUE index ignores NULLs (standard Postgres semantics), so multiple legacy
-- NULL-session keys coexist. Additive only. Safe to re-apply against prod.

ALTER TABLE intel_api_keys
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS intel_api_keys_checkout_session_key
  ON intel_api_keys (stripe_checkout_session_id);
