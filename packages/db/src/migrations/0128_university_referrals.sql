-- 0128_university_referrals.sql
-- Coherent Ones University — refer-a-friend (credit-only) + the SHARED member
-- credit ledger. Implements PHASE 1 of designs/DESIGN-referral-program.md.
--
-- THREE tables. Email is the durable join key; account_id fills in on login —
-- attribution happens at checkout, where the email is known but the
-- customer_accounts login identity may not be resolved yet (same convention as
-- university_members / university_subscriptions in 0122).
--
--   university_referral_codes  — one code per member. UNIQUE(code) + UNIQUE(email).
--                                Lazily created (portal / first earn). Random
--                                Crockford base32, NOT derived from the email so
--                                the code can't leak it.
--   university_referrals       — the attribution record, ONE per referred member.
--                                UNIQUE(referred_email) is the first-touch lock:
--                                a member can only ever be referred once, and the
--                                first link wins (ON CONFLICT DO NOTHING in the
--                                handler). status records self_referral_blocked /
--                                reversed for audit rather than deleting.
--   university_credit_ledger   — the ONE shared, append-only, signed ledger. BOTH
--                                referral AND (future) repost-for-credit write
--                                here, so there is a single balance and a single
--                                floor check — making it arithmetically
--                                impossible to double-discount past the floor.
--                                Balance = SUM(amount_cents) WHERE email = ?.
--                                Never UPDATE/DELETE a row; corrections are new
--                                signed rows. Idempotency:
--                                UNIQUE(source, source_ref_id, stripe_invoice_id, kind)
--                                — a re-delivered webhook for the same referral +
--                                invoice + kind cannot double-credit.
--
-- Money is integer cents throughout. uuid PKs, withTimezone timestamps — matches
-- the 0122-0124 hand-written style. Additive only: 3 tables + 11 indexes
-- (4 unique). CREATE ... IF NOT EXISTS everywhere. Safe to re-apply against prod.

-- ---------------------------------------------------------------------------
-- university_referral_codes — one code per member
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS university_referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable owner key
  code TEXT NOT NULL,                                -- short, URL-safe (Crockford base32)
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The code is the public attribution token — globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS university_referral_codes_code_key
  ON university_referral_codes (code);

-- Exactly one code per member (keyed on the durable email identity).
CREATE UNIQUE INDEX IF NOT EXISTS university_referral_codes_email_key
  ON university_referral_codes (email);

CREATE INDEX IF NOT EXISTS university_referral_codes_account_idx
  ON university_referral_codes (account_id);

-- ---------------------------------------------------------------------------
-- university_referrals — the attribution record (one per referred member)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS university_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_code TEXT NOT NULL,                       -- code used at checkout
  referrer_email TEXT NOT NULL,                      -- denormalized owner email (lowercased)
  referrer_account_id UUID,                          -- filled when known
  referred_email TEXT NOT NULL,                      -- the new member's email (lowercased)
  referred_member_id UUID REFERENCES university_members(id),         -- filled by webhook
  referred_subscription_id UUID REFERENCES university_subscriptions(id), -- filled by webhook
  stripe_subscription_id TEXT,                       -- referred member's sub (idempotency join)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','churned','reversed','self_referral_blocked')),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- first-touch lock time
  activated_at TIMESTAMPTZ,                           -- first successful paid invoice
  ended_at TIMESTAMPTZ,                               -- when the reward stream stopped
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The attribution lock: a member can only ever be referred ONCE (first-touch
-- wins via ON CONFLICT DO NOTHING in the handler).
CREATE UNIQUE INDEX IF NOT EXISTS university_referrals_referred_email_key
  ON university_referrals (referred_email);

CREATE INDEX IF NOT EXISTS university_referrals_referrer_status_idx
  ON university_referrals (referrer_email, status);

CREATE INDEX IF NOT EXISTS university_referrals_stripe_sub_idx
  ON university_referrals (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS university_referrals_referred_member_idx
  ON university_referrals (referred_member_id);

-- ---------------------------------------------------------------------------
-- university_credit_ledger — the ONE shared ledger (referral + repost)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS university_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable key
  amount_cents INTEGER NOT NULL,                     -- +earned, -applied (signed)
  kind TEXT NOT NULL
    CHECK (kind IN ('referral_earned','referral_reversed','repost_earned','credit_applied','admin_adjust')),
  source TEXT NOT NULL
    CHECK (source IN ('referral','repost','admin')),
  source_ref_id UUID,                                -- FK-by-convention to the source row
  stripe_invoice_id TEXT,                            -- set on credit_applied / *_earned / reversed
  reason TEXT,                                        -- human note (refund, dispute, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: never double-credit one referral for one invoice + kind. A
-- re-delivered invoice.paid / charge.refunded webhook hits this and no-ops.
-- NULLs do not collide in a UNIQUE index, so rows without a source_ref_id or
-- invoice id (e.g. admin_adjust) are not constrained against each other — which
-- is correct: those are intentional, manually-distinct rows.
CREATE UNIQUE INDEX IF NOT EXISTS university_credit_ledger_idem_uq
  ON university_credit_ledger (source, source_ref_id, stripe_invoice_id, kind);

CREATE INDEX IF NOT EXISTS university_credit_ledger_email_idx
  ON university_credit_ledger (email);

CREATE INDEX IF NOT EXISTS university_credit_ledger_account_idx
  ON university_credit_ledger (account_id);

CREATE INDEX IF NOT EXISTS university_credit_ledger_invoice_idx
  ON university_credit_ledger (stripe_invoice_id);
