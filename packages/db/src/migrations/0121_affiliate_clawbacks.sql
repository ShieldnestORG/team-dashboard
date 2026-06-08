-- 0121_affiliate_clawbacks.sql
-- First-class clawback recovery flow.
--
-- Background. When a commission that has already been disbursed (status 'paid',
-- or 'scheduled_for_payout' whose parent payout is already 'sent') is refunded
-- or hit by a compliance clawback, the existing code flips it to 'clawed_back'
-- but intentionally does NOT mutate the sent/paid payout row (that would falsify
-- a disbursed batch total — see services/payout-adjust.ts decrementUnsentPayouts).
-- Until now 'clawed_back' was a dead-end label with no way to recover the money.
--
-- This migration adds the ledger that turns 'clawed_back' into a recoverable
-- balance netted against the affiliate's FUTURE payouts:
--   * affiliate_clawbacks  — one row per recovery obligation.
--   * payouts.clawback_applied_cents — how much of a payout's gross was withheld
--     to repay outstanding clawbacks (net cash sent = amount_cents - this).
--
-- Recovery is applied at mark-sent time (the moment cash actually leaves), so the
-- batcher and the reversal-guard math (amount_cents == SUM of linked commissions)
-- are left untouched while a payout is still 'scheduled'.
--
-- Policy: net-against-future-earnings only (no invoicing the affiliate). An
-- obligation not fully recovered before window_expires_at is flagged for admin
-- write-off by the affiliate:clawback-writeoff daily cron.
--
-- Additive only. Safe to apply against prod.

CREATE TABLE IF NOT EXISTS affiliate_clawbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  affiliate_id UUID NOT NULL REFERENCES affiliates(id),

  -- The commission whose disbursed money we are recovering. One clawback per
  -- commission (unique below) — gives idempotency for re-delivered refund
  -- webhooks and prevents double-recording the same obligation.
  source_commission_id UUID NOT NULL REFERENCES commissions(id),

  -- Amount owed back (the source commission's amount_cents at clawback time).
  origin_amount_cents INTEGER NOT NULL,
  -- Accumulates as future payouts are netted against this obligation.
  recovered_cents INTEGER NOT NULL DEFAULT 0,

  -- open       — outstanding, nothing recovered yet
  -- recovering — partially recovered
  -- recovered  — fully recovered (recovered_cents >= origin_amount_cents)
  -- written_off — window elapsed with a balance still outstanding (admin/cron)
  status TEXT NOT NULL DEFAULT 'open',

  -- Why this clawback exists. Mirrors commissions.clawback_reason:
  -- 'stripe_refund' | 'compliance_violation' | 'admin_manual'.
  reason TEXT NOT NULL,

  -- After this instant, an unrecovered balance is eligible for write-off.
  window_expires_at TIMESTAMPTZ NOT NULL,

  -- Board actor who initiated a manual clawback; NULL for automated
  -- (webhook / compliance) paths.
  created_by_user_id UUID,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One obligation per source commission — idempotency + no double recovery.
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_clawbacks_source_commission_uq
  ON affiliate_clawbacks(source_commission_id);

-- Outstanding-balance lookups filter by (affiliate_id, status).
CREATE INDEX IF NOT EXISTS affiliate_clawbacks_affiliate_status_idx
  ON affiliate_clawbacks(affiliate_id, status);

-- Write-off cron scans for elapsed windows on still-open obligations.
CREATE INDEX IF NOT EXISTS affiliate_clawbacks_window_idx
  ON affiliate_clawbacks(window_expires_at)
  WHERE status IN ('open', 'recovering');

-- Net cash disbursed for a payout = amount_cents - clawback_applied_cents.
-- amount_cents stays the gross sum of linked commissions so the reversal guard
-- (which decrements scheduled payouts) is unaffected.
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS clawback_applied_cents INTEGER NOT NULL DEFAULT 0;
