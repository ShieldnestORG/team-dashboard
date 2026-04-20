-- Phase 1: Affiliate attribution + lead lock
-- Adds per-lead attribution rows, first-touch capture, admin override trail,
-- and a policy-acceptance timestamp on affiliates.

ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS policy_accepted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS referral_attribution (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                      UUID NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
  affiliate_id                 UUID NOT NULL REFERENCES affiliates(id),

  attribution_type             TEXT NOT NULL DEFAULT 'affiliate_referred_cd_closed',

  lock_start_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_expires_at              TIMESTAMPTZ NOT NULL,
  lock_released_at             TIMESTAMPTZ,

  first_touch_logged           BOOLEAN NOT NULL DEFAULT FALSE,
  first_touch_type             TEXT,
  first_touch_date             TIMESTAMPTZ,
  first_touch_notes            TEXT,
  relationship_warmth          TEXT,

  affiliate_close_preference   TEXT,

  admin_override               BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason              TEXT,

  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active (not released) attribution per lead.
CREATE UNIQUE INDEX IF NOT EXISTS referral_attribution_active_lead_uq
  ON referral_attribution (lead_id)
  WHERE lock_released_at IS NULL;

CREATE INDEX IF NOT EXISTS referral_attribution_affiliate_idx
  ON referral_attribution (affiliate_id);

CREATE INDEX IF NOT EXISTS referral_attribution_lock_expires_idx
  ON referral_attribution (lock_expires_at)
  WHERE lock_released_at IS NULL;

-- Backfill: every existing partner_companies row with an affiliate_id gets a
-- grandfathered attribution row. Lock is already expired so Phase 1 code
-- treats these as historic.
INSERT INTO referral_attribution (
  lead_id, affiliate_id, attribution_type, lock_start_at, lock_expires_at, lock_released_at
)
SELECT
  pc.id,
  pc.affiliate_id,
  'affiliate_referred_cd_closed',
  COALESCE(pc.created_at, NOW()),
  COALESCE(pc.created_at, NOW()),
  COALESCE(pc.created_at, NOW())
FROM partner_companies pc
WHERE pc.affiliate_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM referral_attribution ra WHERE ra.lead_id = pc.id
  );
