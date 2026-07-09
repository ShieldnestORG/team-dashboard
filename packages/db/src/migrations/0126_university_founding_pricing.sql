-- 0126_university_founding_pricing.sql
-- Coherent Ones University — "Founding 100" pricing.
--
-- The first 100 paying members lock the founding rate ($50/mo); everyone after
-- pays the standard rate ($79/mo). 0122 shipped the member/subscription tables
-- but recorded neither "is this a founder?" nor "what do they pay?", so the
-- founding mechanism has nothing to stand on. This migration adds those two
-- facts:
--
--   university_members.is_founding
--     Was this member ever granted the founding price? Stamped at the webhook
--     when a checkout completes on the founding price. This boolean is the
--     MONOTONIC counter that drives the public $50→$79 switch: the public price
--     flips when COUNT(*) WHERE is_founding reaches UNIVERSITY_FOUNDING_CAP
--     (default 100). It is never unset — a founder who cancels still "spent" a
--     seat, so the price never flip-flops back to $50 ("no resets" brand rule).
--
--   university_subscriptions.stripe_price_id / unit_amount_cents
--     WHAT the member actually pays. 0122 recorded neither; the amount lived
--     only on the Stripe Price object. Recording it makes the row
--     self-describing for audit, powers the referral-credit headroom (which was
--     hardcoded to $50), and is the source of truth for is_founding (a founder
--     is exactly a member whose subscription is on the founding price).
--
-- GRANDFATHERING needs no column and no code: a Stripe subscription is bound to
-- its Price at creation, and no code path ever reprices an existing sub, so a
-- founder keeps $50 for as long as their subscription stays active. Introducing
-- the $79 price only affects NEW checkouts. See docs/university-founding-pricing.md.
--
-- Additive only: 3 columns + 1 partial index. Safe to apply against prod.

ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS is_founding BOOLEAN NOT NULL DEFAULT false;

-- The checkout route counts founders on every checkout to decide $50 vs $79.
-- A partial index keeps that count trivial as total membership grows past 100.
CREATE INDEX IF NOT EXISTS university_members_founding_idx
  ON university_members (is_founding) WHERE is_founding;

ALTER TABLE university_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

ALTER TABLE university_subscriptions
  ADD COLUMN IF NOT EXISTS unit_amount_cents INTEGER;
