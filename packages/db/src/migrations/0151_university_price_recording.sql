-- 0151_university_price_recording.sql
-- Coherent Ones University — record WHAT each subscription actually bills.
--
-- Completes the Founding-100 pricing mechanism started in 0129 (which added
-- university_members.founding, the lifetime price-lock flag). 0129 gave us WHO
-- is a founder; nothing recorded WHAT anyone pays — the amount lived only on
-- the Stripe Price object. That was tolerable while University sold a single
-- $50/mo price, but the founding cap introduces a second ($79/mo standard)
-- price, and three things need the per-subscription amount:
--
--   1. AUDIT / REVENUE INTEGRITY — the subscription row becomes
--      self-describing: which Stripe price it was created on and how many
--      cents it bills. "Founder" is verifiable against "paid the founding
--      price" without a Stripe round-trip.
--   2. RECEIPTS — the receipt email shows the member's real amount, not a
--      hardcoded "$50.00" (a lie for $79 members).
--   3. REFERRAL CREDIT — the credit-apply headroom is computed against the
--      member's real dues (services/university-referrals.ts), not a hardcoded
--      $50, so a $79 member's bill still lands >= the $5 floor correctly.
--
-- The webhook (services/university-stripe-handler.ts) stamps both columns on
-- checkout.session.completed from the checkout-set session metadata. Rows
-- created before this migration stay NULL — every pre-0151 subscription was
-- created on the founding-era prices ($50/mo or $500/yr), and consumers fall
-- back to those plan defaults when NULL.
--
-- GRANDFATHERING needs no column: a Stripe subscription is bound to its Price
-- at creation and no code path ever reprices an existing subscription, so
-- introducing the $79 price only affects NEW checkouts.
-- See docs/university-founding-pricing.md.
--
-- Additive only: 2 columns, no index (never queried without the row). Safe to
-- re-apply against prod (ADD COLUMN IF NOT EXISTS, mirrors 0122-0129 style).

ALTER TABLE university_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

ALTER TABLE university_subscriptions
  ADD COLUMN IF NOT EXISTS unit_amount_cents INTEGER;
