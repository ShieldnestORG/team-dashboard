# Coherent Ones University — Founding-100 pricing (the $50→$79 switch)

> **Cluster:** university-billing · **Tags:** founding-100, stripe, grandfathering, pricing, revenue-integrity, university, price-switch · **Related:** [stripe-products.md](deploy/stripe-products.md), `server/src/routes/university-checkout.ts`, `server/src/services/university-founding.ts`, `server/src/services/university-stripe-handler.ts`, `packages/db/src/migrations/0151_university_price_recording.sql`

The offer: the **first 100 members pay the founding rate ($50/mo or $500/yr)**; everyone
after pays the **standard rate ($79/mo; standard annual not yet priced)**. This doc is the
source of truth for how the mechanism works, the decisions behind it, and the go-live steps.

Two build layers, two dates:
- **0129 (earlier session):** WHO is a founder — `university_members.founding` flag, the
  monotonic all-members count (`countUniversityMembers`), the webhook stamp, the public
  `GET /api/university/status` badge feed, the storefront seat-count badge (#99).
- **0151 (this branch, 2026-07-08):** WHAT gets charged — the actual price switch. Before
  this, member #101 would have been flagged `founding=false` but still **charged $50**;
  the flag drove a badge, not the price. That was the revenue-integrity gap.

---

## How it works (one paragraph)

At checkout, the member count is **load-bearing**: `count < cap` (env
`UNIVERSITY_FOUNDING_CAP`, default 100) → the founding price for the chosen plan
(lookup keys `university_monthly` / `university_annual`); past the cap → the standard price
(`university_monthly_standard` / env `UNIVERSITY_STRIPE_STANDARD_PRICE_ID`). An **unknown
count refuses checkout (503)** — we never guess a price — and an **unconfigured standard
price refuses checkout (503)** — we never sell the founding rate past the cap. The webhook
records the price actually billed (`stripe_price_id`, `unit_amount_cents`, migration 0151)
and stamps `founding` from the tier that billed (`metadata.founding_price`; legacy in-flight
sessions fall back to the 0129 count-recheck). **Grandfathering is automatic**: a Stripe
subscription stays bound to the Price it was created on and no code ever repoints it —
introducing the $79 price affects new checkouts only.

## The pieces

| Concern | Where |
|---|---|
| Founder flag + monotonic count (0129) | `server/src/services/university-founding.ts`, `packages/db/src/migrations/0129_university_annual.sql` |
| Price recording (0151) | `packages/db/src/migrations/0151_university_price_recording.sql`, `packages/db/src/schema/university.ts` (`stripePriceId`, `unitAmountCents`) |
| Tier selection + fail-closed | `server/src/routes/university-checkout.ts` — `resolveUniversityFoundingPrice`, `resolveUniversityStandardPrice`, `STANDARD_PRICE_CONFIG` |
| Public price feed | `GET /api/university/status` (same file) — `plans.*.priceCents/priceDisplay` + `plans.annual.available`, 60s in-process cache |
| Founder stamp + price recording at payment | `server/src/services/university-stripe-handler.ts` — `handleUniversityCheckout` |
| Amount-true receipts + owner alerts | same file + `university-email.ts` `amountDisplay()` |
| Referral-credit headroom per real dues | `server/src/services/university-referrals.ts` — `memberDuesCents` |
| Storefront price surfaces | landing repo: `components/labs/price-counter.tsx` (reserve page), `components/labs/university-join.tsx` (join page: hero, CTA, ROSCA attestation + disclosure, closing card — ALL server-driven) |

## Decisions (owner, 2026-07-08 unless noted)

1. **Soft cap.** Checkout reads the count, never reserves a seat. A burst at the boundary can
   mint a few extra $50 founders — bounded, accepted. Reserving seats would strand them on
   abandoned checkouts and flip-flop the public price.
2. **Monotonic switch.** `founding` is never unset; the count includes ALL members ever
   (2026-07-05 owner decision, incl. internal/agent accounts). Price switches once, never back.
3. **Leavers lose $50.** Cancel + re-subscribe after the switch = then-current price. Zero
   special code (automatic). Copy says "rate never rises while you're a member" — never
   "for life". A returning founder keeps the `founding` flag (seat stays spent) but their new
   subscription bills the current price.
4. **Fail closed, both directions.** Unknown count → 503. Unconfigured standard price → 503.
   Annual past the cap fails closed until the owner prices `university_annual_standard`.
5. **Never mutate the founding prices.** Don't edit amounts, don't archive. Add prices and
   switch *selection*, never *mutation* — that's the whole grandfather guarantee.
6. **Price swap only on the public page** (no scarcity theatre); the join page's live
   seat-count badge (#99, owner-approved 2026-07-05) stays.

## Edge cases

- **#100 vs #101:** `isFoundingEligible(count, cap)` = `count < cap`. existingCount 99 → the
  100th founder at $50; existingCount 100 → #101 pays $79. Unit-tested
  (`university-founding-pricing.test.ts`, plus 0129's `university-founding.test.ts`).
- **In-flight sessions across the deploy:** no `founding_price` metadata → webhook falls back
  to the 0129 count-recheck; they all billed founding-era prices, so the fallback is exact.
- **Checkout-vs-activation race at the boundary:** the stamp follows the price actually
  billed, so "founder" and "pays the founding rate" can never disagree.
- **Reservations (Brevo list) never consume seats** — only paid activations count.
- **Pre-0151 rows:** `unit_amount_cents` NULL → consumers fall back to plan defaults
  ($50/$500) — exact for every pre-0151 subscription.

## Go-live steps (owner or authorized deploy)

1. **Create the standard monthly price** on the **Starwise** Stripe account: $79/mo recurring
   USD on the existing "Coherent Ones University" product, **lookup key
   `university_monthly_standard`** (or set `UNIVERSITY_STRIPE_STANDARD_PRICE_ID`).
   Optional, later: standard annual via `university_annual_standard` /
   `UNIVERSITY_ANNUAL_STANDARD_PRICE_ID` — until then annual closes at the cap.
2. **Apply migration `0151`** (additive, `IF NOT EXISTS`, safe on prod). Check prod for
   out-of-band tables first (2026-07-02 incident lesson).
3. **Env on VPS4:** `UNIVERSITY_FOUNDING_CAP=100` (set 2026-06-20; now actually load-bearing).
   No new required envs — standard-price cents default to 7900 for display.
4. **Rotate the leaked `sk_live`** (standing flag).
5. **Smoke:** `GET /api/university/status` → `founding.available:true`,
   `plans.monthly.priceCents:5000`. Then with `UNIVERSITY_FOUNDING_CAP=0` (temporary) →
   `plans.monthly.priceCents:7900`, checkout resolves the standard price (or 503s if step 1
   skipped), existing $50 subscriber unaffected. Reset cap to 100.

## Known limitations / follow-ups

- **SSR price post-cap:** storefront components default to $50 in SSR HTML and swap on
  hydration. Correct while founders remain; near the cap, move the /status fetch server-side.
- **Standard ANNUAL price is an open owner decision** (suggestion: $790/yr keeps the
  2-months-free shape). Until priced, annual quietly disappears from the join page post-cap.
- **Badge copy for returning founders:** a founder who lapses and rejoins at $79 keeps the
  `founding` flag; portal surfaces reading it as "founding rate" would be stale. Portal copy
  should read it as "Founding 100 member" (historical), not a price claim.
- **`countUniversityMembers` counts pending/cancelled rows** (deliberate: seats stay spent).
