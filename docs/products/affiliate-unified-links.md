# Unified Affiliate Links (one global `?ref=` system)

**Status:** Phase 1 (attribution links) + the team-dashboard half of Phase 3
(commission ledger + inert Woo ingest endpoint) shipped. Phase 2 (storefront
cookie/propagation) and the Woo-side adapter pending sessions on those systems.
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

## Phase 3 — Commission / payout — dashboard side SHIPPED, Woo side BLOCKED

Commission model decision made: **a new lightweight `shop_commissions` ledger**,
decoupled from the B2B affiliate engine (no entangling merch payouts with SaaS
clawback/tier logic). The team-dashboard half is built and inert until the Woo
secret is set. The actual *sale signal* still lives in WooCommerce (Hostinger),
so end-to-end payout remains **blocked on Woo-side config**.

### Shipped (team-dashboard)
- **`shop_commissions` table** (migration `0122`) — `sharer_id`, `referral_code`,
  `referral_event_id`, `order_ref` (unique → idempotency), `gross_amount_cents`,
  `rate`, `commission_cents`, `currency`, `status` (pending|approved|paid|void).
- **Ingestion endpoint** `POST /api/shop/woo/order` — **inert until
  `WOO_WEBHOOK_SECRET` is set** (returns 503). Verifies an HMAC-SHA256 (hex)
  signature in the `X-CD-Signature` header over the canonical payload, then
  records the sale: a `shop_referral_events` `purchase` row + a `shop_commissions`
  row, in one transaction, idempotent on `order_ref`.
- **`GET /api/shop/admin/commissions`** (board auth) + a read-only "Influencer
  commissions" table on `/shop-sharers`.
- Rate from `SHOP_AFFILIATE_COMMISSION_RATE` (default `0.10`), snapshotted per row.

### Ingestion contract (what the Woo-side adapter must send)
```
POST /api/shop/woo/order
Header: X-CD-Signature: <hex HMAC-SHA256(WOO_WEBHOOK_SECRET, payload)>
Body:   { "orderRef": "...", "ref": "<code>", "grossAmountCents": <int>,
          "currency": "usd", "status": "paid" }
payload = [orderRef, ref, grossAmountCents, currency, status].join("|")
```
Statuses treated as a sale: `paid`, `completed`, `processing`. We use **our own
clean contract** (not Woo's native payload) so a thin Woo-side adapter/plugin can
post it after stamping the incoming `cd_ref` (from Phase 2.4) onto the order.

### Still required (outside this repo)
1. **Woo-side adapter (Hostinger):** on a paid order carrying `_cd_ref`, POST the
   contract above signed with the shared secret. This is the missing sale signal.
2. **Payout runner:** nothing yet moves rows out of `pending`. A future cron
   (hold past the refund window → `approved` → batch → `paid`) + a refund→`void`
   path. Mirror the B2B holdback/clawback discipline at whatever fidelity merch
   margins justify.

### Open questions
- Programmable webhook/adapter available on the Hostinger Woo store? (Gates #1.)
- Per-sharer commission rate vs the global default?
- Refund/return clawback policy for physical goods (drives the `void` path)?

## How to execute the parts not reachable here

- **Phase 2:** start a Claude Code session on `coherencedaddy-landing` and apply
  the drop-in patches in the appendix below.
- **Phase 3 Woo side:** needs Hostinger/WooCommerce admin access + a decision on
  the order webhook; not a code-only task in either repo.

## Appendix — Phase 2 drop-in code (coherencedaddy-landing)

Written from the PR #58 file map. **Typecheck in that repo's CI before merge** —
these were authored without the landing repo available, so treat as a strong
draft, not CI-verified. File paths assume the layout described in PR #58.

### A. Persist the ref — `components/shop/ref-beacon.tsx`

Add a first-touch cookie write at the top of the existing effect (keep the
existing `/api/shop/ref/hit` beacon call as-is). Host-only cookie on
`outrizzd.com` — we deliberately don't set a cross-domain `Domain` (the two shop
hosts `outrizzd.com` / `coherencedaddy.com` are different registrable domains,
and the Woo hand-off carries the ref explicitly — see C).

```ts
const REF_COOKIE = "cd_ref";
const REF_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// inside the existing useEffect, before the beacon fires:
const ref = new URLSearchParams(window.location.search).get("ref");
// First-touch attribution: only set if a ref is present and none stored yet.
if (ref && !readCookie(REF_COOKIE)) {
  document.cookie =
    `${REF_COOKIE}=${encodeURIComponent(ref)}; path=/; max-age=${REF_MAX_AGE}; SameSite=Lax`;
}
```

(First-touch chosen so a later un-reffed visit doesn't overwrite the original
referrer. Switch the `!readCookie` guard to always-set for last-touch.)

### B. Verify `?ref=` survives the deep-link flow

Query strings ride through 307s and Next rewrites, so this is likely already
fine — confirm with:

```bash
curl -sI 'https://outrizzd.com/p/<id>?ref=remy' | grep -i location   # ref kept on any redirect
curl -sI 'https://shop.coherencedaddy.com/p/<id>?ref=remy'           # 200 via middleware rewrite
```

If `middleware.ts` reconstructs the URL for the `shop.coherencedaddy.com → /shop-home`
rewrite, ensure it preserves `request.nextUrl.search`.

### C. Carry the ref into the Woo checkout hand-off

The Woo store (`outrizzd.shop`) is a different domain, so the cookie won't cross.
Append the stored ref to the outbound "Buy"/cart URL so Woo can stamp it as
`_cd_ref` order meta (feeds Phase 3).

```ts
// lib/ref.ts
export function appendRef(url: string): string {
  if (typeof document === "undefined") return url;
  const m = document.cookie.match(/(?:^|; )cd_ref=([^;]*)/);
  const ref = m ? decodeURIComponent(m[1]) : null;
  if (!ref) return url;
  const u = new URL(url, window.location.origin);
  if (!u.searchParams.has("ref")) u.searchParams.set("ref", ref);
  return u.toString();
}
```

Wrap every external Woo checkout/"Buy" link: `href={appendRef(wooCheckoutUrl)}`.

### D. Share-button policy — `components/shop-preview/shop-preview-client.tsx`

Recommendation: the "Share this shirt" button emits a **clean** `outrizzd.com/p/<id>`
link (do **not** append the current visitor's `cd_ref`). Only an influencer's own
posted links should carry their ref; propagating an inherited ref would let any
shopper's re-share credit the original influencer (attribution laundering). No
code change if the button already builds a clean link.

### E. Woo-side adapter (Hostinger, Phase 3)

On a paid order carrying `_cd_ref`, POST the signed contract from the Phase 3
section to `https://api.coherencedaddy.com/api/shop/woo/order`. Pseudo:

```
sig = hmac_sha256_hex(WOO_WEBHOOK_SECRET, `${orderId}|${ref}|${totalCents}|${currency}|${status}`)
POST {orderRef: orderId, ref, grossAmountCents: totalCents, currency, status}
  with header X-CD-Signature: sig
```

## Cross-references
- `docs/products/shop-sharers.md` — the ref code / beacon / admin system.
- `docs/architecture/org-structure.md` — shop storefront tiers + Woo authority.
- coherencedaddy-landing PR #58 — per-shirt `/p/<id>` share + OG cards.
- team-dashboard PR #107 — admin-created affiliate links (Phase 1).
