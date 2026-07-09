# Coherent Ones University — Founding-100 pricing

> **Cluster:** university-billing · **Tags:** founding-100, stripe, grandfathering, pricing, revenue-integrity, university · **Related:** [stripe-products.md](deploy/stripe-products.md), `server/src/routes/university-checkout.ts`, `server/src/services/university-stripe-handler.ts`, `packages/db/src/migrations/0126_university_founding_pricing.sql`

The offer: the **first 100 paying members lock the founding rate ($50/mo)**; everyone
after pays the **standard rate ($79/mo)**. This doc is the source of truth for how the
mechanism works, the decisions behind it, and what the owner must do before it goes live.

Built on branch `feat/university-founding-pricing` (2026-07-08). Backend + storefront only —
no deploy performed here.

---

## How it works (one paragraph)

A member is a **founder** iff their subscription was created on the **founding Stripe price**.
The checkout route counts existing founders (`COUNT(*) WHERE is_founding`), and if that count
is below the cap it checks the customer out on the founding ($50) price, otherwise the standard
($79) price. The webhook records which price actually billed and stamps `is_founding` on the
member. **Grandfathering is automatic**: a Stripe subscription is bound to its Price at creation
and no code ever reprices an existing subscription, so introducing the $79 price only affects
*new* checkouts — existing $50 members keep $50.

---

## The pieces

| Concern | Where |
|---|---|
| `is_founding` (member) + `stripe_price_id` / `unit_amount_cents` (subscription) | migration `0126_university_founding_pricing.sql`, schema `packages/db/src/schema/university.ts` |
| Price selection (count < cap ? $50 : $79) | `server/src/routes/university-checkout.ts` — `countFoundingMembers`, `universityFoundingCap`, `resolveUniversityFoundingPrice`, `resolveUniversityStandardPrice` |
| Public price display | `GET /api/university/status` (same file), consumed by storefront `components/labs/price-counter.tsx` |
| Stamping founder + price at payment | `server/src/services/university-stripe-handler.ts` — `handleUniversityCheckout` |
| Referral-credit headroom (now per-tier) | `server/src/services/university-referrals.ts` — `memberDuesCents` |

---

## Decisions (and why)

1. **Soft cap, not hard.** The checkout route only *reads* the founder count to pick the price —
   it never reserves a seat. Under a burst of simultaneous checkouts at the exact boundary, a
   small, bounded overage of founders can occur (e.g. 3 people at seat 99 all get $50). We accept
   this because a true zero-overage cap would require reserving a seat at checkout, which strands
   seats on abandoned checkouts and makes the public price flip-flop. A handful of extra founders
   is a non-event; everyone who paid $50 is legitimately a founder. `is_founding` is derived from
   the price actually billed, so the record is always self-consistent.

2. **Monotonic counter.** `is_founding` is **never unset** — a founder who cancels still "spent"
   a seat. So the founder count only grows and the public price switches $50→$79 **once and never
   flips back**, even if founders later churn. This honors the brand's "no resets, no fake timers"
   rule and never surprises a $79 payer with a $50 they can see.

3. **Leavers don't keep $50 (owner decision, 2026-07-08).** The founding rate is tied to a
   continuous subscription. If a founder cancels and re-subscribes after the switch, they pay the
   **then-current price** ($79). This needs *no special code* — a cancelled subscription's price
   simply no longer applies, and re-subscribing runs normal checkout at the current tier. A
   returning founder keeps `is_founding=true` (so the monotonic count doesn't drop) but their new
   subscription's `plan` / `unit_amount_cents` reflect the $79 they now pay.

4. **Grandfather = never mutate the founding price.** DO NOT edit the amount of, or archive, the
   $50 Stripe price. Stripe prices are immutable on amount; the safe pattern is exactly what the
   code does — add a *separate* $79 price and switch *selection*, never *mutation*. Archiving the
   $50 price would not reprice existing subs but would break re-billing edge cases; leave it active.

---

## Edge cases

- **Member #100 vs #101.** Decided at checkout: with cap=100, seats 0–99 are founding (member
  #100 is the 100th founder); at count=100 the window is closed and #101 pays $79. Unit-tested in
  `server/src/__tests__/university-founding-pricing.test.ts`.
- **A $50 member cancels, then re-subscribes after the switch** → they pay $79 (decision #3).
- **A $50 member stays subscribed** → keeps $50 indefinitely (automatic grandfather).
- **Reservations (Brevo list) do not consume founding seats** — only a *paid* checkout grants
  founding. First-100-to-**pay**, not first-100-to-reserve.

---

## Owner actions required before this is live

1. **Create the standard ($79) price on the Starwise Stripe account.** Recurring monthly, USD,
   product = the existing "Coherent Ones University" product. Set its **lookup key** to
   `university_monthly_standard` (preferred — stable across mode rotations), OR set env
   `UNIVERSITY_STRIPE_STANDARD_PRICE_ID` to its price id. Until this exists, checkout **fails
   closed** once the cap is reached (503) rather than selling $50 past 100 — by design.
2. **Apply migration** `0126_university_founding_pricing.sql` (additive; safe on prod).
3. **Env** (team-dashboard / VPS4):
   - `UNIVERSITY_FOUNDING_CAP=100` (already set per prior notes; now actually read).
   - `UNIVERSITY_FOUNDING_PRICE_CENTS=5000` and `UNIVERSITY_STANDARD_PRICE_CENTS=7900` — used only
     for the public `/status` display and as the recorded amount on env-id fallback. **Keep these
     in sync with the Stripe prices.**
4. **Rotate the leaked `sk_live` key** (standing flag from earlier sessions).
5. **Smoke test in staging:**
   - `GET /api/university/status` returns `{ foundingAvailable: true, priceDisplay: "$50" }`.
   - Temporarily set `UNIVERSITY_FOUNDING_CAP=0` (or seed 100 `is_founding` rows) → `/status`
     flips to `$79` and a new checkout is created on the $79 price.
   - Confirm an existing $50 subscriber's next invoice is still $50 (grandfather).

---

## Known limitations / follow-ups

- **SSR price after the cap.** `price-counter.tsx` defaults to $50 in server-rendered HTML and
  swaps to the real value on the client. Correct today (0 founders); once the cap is near, render
  the price server-side (fetch `/status` in the server page and pass it down) so no-JS/crawlers
  see $79 in the SSR HTML too.
- **Dormant `university-join.tsx`** (the future live-checkout component, not currently routed)
  still carries stale track/price copy and calls `/api/university/status` — now that the endpoint
  exists, wire and copy-audit it when checkout replaces the reservation flow.
- **Referral dues on legacy rows.** `unit_amount_cents` is null on subscriptions created before
  0126; `memberDuesCents` falls back to $50 for those (correct — they're founders). New standard
  members get the real $79. No backfill needed unless a pre-0126 member is ever on $79 (they
  can't be — $79 didn't exist yet).
