-- 0148_university_voice_addons.sql
-- Coherent Ones University — paid Rex voice add-ons (Phase 2). A member's monthly
-- Rex voice cap is the free 3600 s/mo (university_voice_meter) PLUS the seconds
-- granted by an ACTIVE add-on subscription. Add-ons are NON-additive: the cap
-- takes the MAX over active rows ('1hr' → +3600 s, '2p5hr' → +9000 s). One row
-- per Stripe subscription; the checkout webhook upserts on stripe_subscription_id
-- and customer.subscription.updated/.deleted mirror status + current_period_end.
-- Backs POST /api/portal/university/voice/addon-checkout + the Starwise webhook
-- (services/university-stripe-handler.ts).
--
-- Hand-written in the repo's forward-only convention (no drizzle journal/snapshot),
-- next free slot after 0147. Additive only; `IF NOT EXISTS` keeps it a safe no-op
-- on any environment that already has the table. Member identity is the same
-- university_members id used by university_voice_meter (resolveVoiceMemberId).

CREATE TABLE IF NOT EXISTS university_voice_addons (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  member_id              UUID        NOT NULL,
  stripe_subscription_id TEXT        NOT NULL,
  stripe_price_id        TEXT,
  tier                   TEXT        NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'active',
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT university_voice_addons_tier_ck CHECK (tier IN ('1hr', '2p5hr')),
  CONSTRAINT university_voice_addons_status_ck CHECK (status IN ('active', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS university_voice_addons_stripe_sub_uq
  ON university_voice_addons (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS university_voice_addons_member_status_idx
  ON university_voice_addons (member_id, status);
