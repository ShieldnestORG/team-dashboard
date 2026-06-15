# Unified Affiliate Links (one global `?ref=` system)

**Status:** Phase 1 (attribution foundation) shipped in team-dashboard. Phases 2–3
specced below, pending sessions on the repos/systems they touch.
**Started:** 2026-06-15

## Goal

One link system that is *both* a deep-link to a specific shirt *and* attributed
to the influencer who shared it — so we know which affiliate drove each click
(and, eventually, each sale). Driven by our AI influencers (Remy, Bri, Solene,
Mami) sharing shop links.

## The problem this solves

We shipped two link systems that don't overlap:

| Link | Deep-links to a shirt? | Knows who shared it? | Owned by |
|---|---|---|---|
| `outrizzd.com/p/<id>` (per-shirt share, coherencedaddy-landing PR #58) | ✅ | ❌ | landing |
| `…/?ref=<code>` (Shop Sharers, team-dashboard PR #107) | ❌ (shop home) | ✅ | team-dashboard |

An influencer naturally grabs the *product* link → no attribution. This unifies
them: **`?ref=<code>` is the single global attribution token, valid on any shop
URL including `/p/<id>`.**

```
https://outrizzd.com/p/<id>?ref=remy   ← specific shirt, credited to Remy
https://outrizzd.com/?ref=remy         ← whole shop, credited to Remy
```

No discount is ever attached — pure attribution (matches the Shop Sharers
design: sharers are kept out of the discount/finance pipeline).

## Three-system architecture

The full feature spans three systems; only the first is in this repo.

1. **team-dashboard** (this repo) — mints ref codes, builds the canonical
   links, receives the `/api/shop/ref/hit` beacon, will hold commissions/payouts.
2. **coherencedaddy-landing** — the storefront (`outrizzd.com` /
   `shop.coherencedaddy.com` previews). Owns the `/p/<id>` route, `middleware.ts`,
   the ref-beacon component, the "Share this shirt" button, and cookie writes.
3. **WooCommerce on Hostinger (`outrizzd.shop`)** — the *authoritative* cart /
   checkout / Stripe. **Separate from both repos** (see
   `docs/architecture/org-structure.md`, `docs/deploy/stripe-runbook.md`). This
   is where a *sale* actually happens, so it is the source of any commission.

## Phase 1 — Attribution foundation (team-dashboard) — SHIPPED

In `server/src/services/shop-sharers.ts`:
- `SHOP_AFFILIATE_BASE_URL` (default `https://outrizzd.com`) — canonical domain
  for affiliate links, matching the storefront's product-share domain.
- `affiliateLinkFor(code, productId?)` — builds `…/?ref=<code>` or
  `…/p/<id>?ref=<code>`. The single link builder.

Admin API + UI (`/shop-sharers`):
- `GET`/`POST /api/shop/admin/sharers` responses now include `affiliateUrl`
  (the outrizzd.com `?ref=` link) alongside the legacy `shareUrl`.
- The "Add affiliate link" form previews `outrizzd.com/?ref=<code>` and explains
  that appending `?ref=<code>` to any product link attributes that click.

`?ref=` hits are already logged by `POST /api/shop/ref/hit` into
`shop_referral_events` (with `path`, so the landed `/p/<id>` is captured). That
is the click-attribution signal today.

## Phase 2 — Persist + propagate the ref (coherencedaddy-landing) — SPEC

Without persistence, the beacon only logs a one-time hit; the referrer is
forgotten on the next navigation, so a later purchase can't be credited. Tasks
(all in `coherencedaddy-landing`):

1. **Capture + persist on landing.** In the ref-beacon component
   (`components/shop/ref-beacon.tsx`), when `?ref=<code>` is present, set a
   first-party cookie `cd_ref=<code>` (90-day, `SameSite=Lax`, domain
   `.outrizzd.com`) **before/alongside** firing `POST /api/shop/ref/hit`.
   Don't overwrite an existing cookie unless a new `ref` is explicitly present
   (first-touch attribution; revisit if last-touch is preferred — open decision).
2. **Preserve `?ref=` through the deep-link flow.** Verify `/p/<id>` route +
   `middleware.ts` rewrites and the apex→www 307 keep the query string (307s
   preserve query, so this is likely already fine — confirm with a curl).
3. **"Share this shirt" propagation (policy decision).** Decide whether a
   shopper who arrived via `?ref=remy` and then taps "Share this shirt" should
   emit a link that *keeps* `?ref=remy` (sub-attribution to Remy) or a clean
   link. Default recommendation: clean link (only the influencer's own posted
   links carry their ref) to avoid attribution laundering.
4. **Send the ref into checkout.** When the visitor proceeds to the WooCommerce
   store, carry `cd_ref` across (querystring on the "Buy"/cart hand-off URL, or
   a hidden field) so Woo can stamp it on the order — see Phase 3.

## Phase 3 — Commission / payout (team-dashboard + WooCommerce) — SPEC, BLOCKED

Paying commission requires a *sale* signal, which lives in WooCommerce, not in
either repo. This phase is **blocked on Woo integration** that does not exist yet.

Design:
1. **Stamp the ref on the Woo order.** Configure the Woo checkout (Hostinger) to
   read the incoming `cd_ref` (from Phase 2.4) and store it as order meta
   (`_cd_ref`). Requires Woo-side config/plugin work — outside both repos.
2. **Woo → team-dashboard sync.** New inbound webhook (e.g.
   `POST /api/shop/woo/order` with HMAC verification) or a polling job that, on a
   paid Woo order carrying `_cd_ref`, writes a `shop_referral_events` row with
   `event_type='purchase'` + `amount_cents` (the reserved-but-unwired purchase
   event — see `docs/products/shop-sharers.md`).
3. **Commission model decision.** Shop Sharers are intentionally *outside* the
   existing affiliate commission engine (which is B2B: `commissions`/`payouts`
   keyed off SaaS subscriptions). Two options:
   - (a) **Reuse** the affiliate finance tables by promoting attributed sharers
     to `affiliates` (already supported via approve) and writing `commissions`
     rows from purchase events. Heaviest integration; reuses payout batcher.
   - (b) **New lightweight ledger** for shop/influencer commissions
     (`shop_commissions`) decoupled from the B2B engine. Simpler, avoids
     entangling merch payouts with SaaS clawback/tier logic. **Recommended.**
4. **Payout path.** Flat % of attributed sale (rate per sharer, default e.g.
   10%), held until the Woo order clears any refund window, then included in a
   payout run. Mirror the B2B holdback/clawback discipline at whatever fidelity
   merch margins justify.

### Phase 3 hard dependencies / open questions
- Is there an owned, programmable Woo/Stripe order webhook on Hostinger? (Needed
  for any sale signal.)
- Commission rate + who sets it (per sharer vs global)?
- Refund/return clawback policy for physical goods?
- Reuse B2B `commissions` (3a) vs new `shop_commissions` ledger (3b)?

## How to execute the parts not reachable here

- **Phase 2:** start a Claude Code session on `coherencedaddy-landing` and hand
  it the Phase 2 spec above.
- **Phase 3 Woo side:** needs Hostinger/WooCommerce admin access + a decision on
  the order webhook; not a code-only task in either repo.

## Cross-references
- `docs/products/shop-sharers.md` — the ref code / beacon / admin system.
- `docs/architecture/org-structure.md` — shop storefront tiers + Woo authority.
- coherencedaddy-landing PR #58 — per-shirt `/p/<id>` share + OG cards.
- team-dashboard PR #107 — admin-created affiliate links (Phase 1).
