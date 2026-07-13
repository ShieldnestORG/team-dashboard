# Stripe Runbook — Coherence Daddy

**Last audited:** 2026-05-09 by full inventory + cross-check against codebase + VPS env.

This is the operational source of truth for all Stripe wiring across the
Coherence Daddy ecosystem. The product registry table in
[stripe-products.md](stripe-products.md) is the per-product spec; this doc
covers the **shared infra** (accounts, webhooks, env contract) and the
**known gotchas** that have bitten us before.

## Account inventory

| Account ID | Name | Owns | Where the secret lives |
|---|---|---|---|
| **`acct_1TJQywQvkbvTR7Og`** ✅ THE ONE | Coherence Daddy (live) | Every product/price ID in `team-dashboard/.env` and on the VPS — **except University**. Suffix `*QvkbvTR7Og` on a price ID = this account. | `STRIPE_SECRET_KEY` in `team-dashboard/.env` (rk_live restricted key). Same key in `/opt/team-dashboard/.env.production` on VPS4. |
| **Starwise Ventures** (University) | Coherent Ones University ONLY | The `university_monthly` price + every University customer / subscription. **Separate legal entity / separate Stripe account** from Coherence Daddy — University revenue is billed here, nothing else is. | `UNIVERSITY_STRIPE_SECRET_KEY` in `/opt/team-dashboard/.env.production` on VPS4. Falls back to `STRIPE_SECRET_KEY` when unset (single-account local/dev/test). |
| `acct_1QF1QeQwTOfgszhy` | Stale / pre-launch sandbox | Nothing this codebase uses | The locally-installed `stripe` CLI is authed to this — DO NOT rely on `stripe ... --live` to target the right account. See gotcha #1 below. |

> **Two-account split:** University products bill on the **Starwise Ventures** Stripe account; every other product (CreditScore, Watchtower, Directory, Partners, Intel API) bills on **Coherence Daddy**. The shared low-level client (`server/src/services/stripe-client.ts` `stripeRequest()`) defaults to `STRIPE_SECRET_KEY` (Coherence Daddy). University-specific call sites — the price lookup + checkout (`routes/university-checkout.ts`) and the billing-portal session for University members (`routes/portal.ts`) — pass `universityStripeKey()` (= `UNIVERSITY_STRIPE_SECRET_KEY ?? STRIPE_SECRET_KEY`) so they hit Starwise. A University checkout/portal call made with the shared CD key would fail because the `university_monthly` price + the customer live only on Starwise.

## Live product + price inventory (audited 2026-05-09)

| Product | Price ID prefix | $ | Cadence | lookup_key | Code |
|---|---|---|---|---|---|
| **Watchtower** | `price_1TseofQ…UBNL` _(prev $29 `price_1TVOu6Q…0GsG` archived 2026-07-13)_ | $49 | monthly | ✅ `watchtower_monthly` | `server/src/services/watchtower-monitor.ts` |
| **Coherent Ones University** _(Starwise acct — NOT CD)_ | _pending — created on Starwise_ | $50 | monthly | ✅ `university_monthly` | `server/src/services/university-stripe-handler.ts` |
| CreditScore — Report (one-time) | `price_1TPd1zQ…fP7vP` | $19 | one-time | (none) | `services/creditscore.ts` |
| CreditScore — Starter | `price_1TPd20Q…A82g0` | $49 | monthly | (none) | same |
| CreditScore — Growth (Monthly) | `price_1TPd21Q…6jHVk` | $199 | monthly | (none) | same |
| CreditScore — Growth (Annual) | `price_1TPd22Q…sOgFh` | $1,188 | yearly | (none) | same |
| CreditScore — Pro | `price_1TPd23Q…NrzaaI` | $499 | monthly | (none) | same |
| Directory — Boosted | `price_1TMGB3Q…2GHzk` | $1,499 | monthly | (none) | `routes/directory*.ts` |
| Directory — Verified | `price_1TMGB2Q…KiX9k` | $499 | monthly | (none) | same |
| Directory — Featured | `price_1TMGB2Q…tR17F` | $199 | monthly | (none) | same |
| Partners — Premium | `price_1TMLijQ…ePNijw` | $499 | monthly | (none) | `routes/partner.ts` |
| Partners — Performance | `price_1TMLijQ…4VLCN3` | $149 | monthly | (none) | same |
| Partners — Proof | `price_1TMLiiQ…30Fg` | $49 | monthly | (none) | same |
| Intel API — Starter (base + metered) | `price_1TMFpQ…I29R5y4c` + `price_1TMFpRQ…tKhGSyDt` | $19 + $0.10 | monthly + metered | (none) | `routes/intel-billing.ts` |
| Intel API — Pro (base + metered) | `price_1TMFpRQ…D1vaL` + `price_1TMFpSQ…7VrtocY` | $49 + $0.05 | monthly + metered | (none) | same |
| Intel API — Enterprise (base + metered) | `price_1TMFpTQ…OSnWp` + `price_1TMFpTQ…wCD6uL` | $199 + $0.03 | monthly + metered | (none) | same |

**Fragility note:** Watchtower is the **only** product using `lookup_key` resolution. Every other product is referenced by bare price ID via env vars (e.g. `STRIPE_PRICE_CREDITSCORE_STARTER`). Adopting `lookup_key` for the others is queued as a follow-up in [open-followups.md](#open-follow-ups) — it's a robustness/migration win, not a today-blocker.

## Live webhook inventory (audited 2026-05-09)

| Endpoint URL | Stripe ID prefix | Events | Secret env var | Purpose |
|---|---|---|---|---|
| `https://api.coherencedaddy.com/api/watchtower/webhook` | `we_1TVP0qQ…BvpSk` | checkout.session.completed, customer.subscription.updated, customer.subscription.deleted | `STRIPE_WEBHOOK_SECRET_WATCHTOWER` (falls back to global) | Watchtower subscription provisioning |
| `https://api.coherencedaddy.com/api/university/webhook` | _pending — not yet registered_ | checkout.session.completed, customer.subscription.updated, customer.subscription.deleted | `STRIPE_WEBHOOK_SECRET_UNIVERSITY` (falls back to global) | Coherent Ones University membership provisioning |
| `https://api.coherencedaddy.com/api/creditscore/webhook` | `we_1TPdKFQ…4PyKd` | checkout.session.completed, invoice.paid, customer.subscription.updated, customer.subscription.deleted | `STRIPE_WEBHOOK_SECRET_CREDITSCORE` | CreditScore subscriptions + reports |
| `https://api.coherencedaddy.com/api/intel-billing/webhook` | `we_1TMFpeQ…2M26sN` | checkout.session.completed, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted | `STRIPE_WEBHOOK_SECRET` (global default) | Intel API metered billing |
| `https://api.coherencedaddy.com/api/stripe/webhook` | `we_1TMGBAQ…UnKlSc` | checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted | `STRIPE_WEBHOOK_SECRET_DIRECTORY` | Directory Listings |
| `https://outrizzd.shop/?wc-api=wc_stripe` | `we_1TPcrlQ…Wq7EEh` | (long list — WooCommerce defaults) | n/a | **Hostinger Woo shop** — separate from this codebase |

**No webhook for:** Bundles (no Stripe product registered yet — see open follow-ups), Partners (route exists but provisioning is manual today).

## Env var contract — what each var does, where it must be set

VPS = `/opt/team-dashboard/.env.production` on **VPS4 (`31.220.61.14`)** — NOT VPS1 (`.12`). Always confirm with `dig +short api.coherencedaddy.com` before SSHing.
Vercel = the public storefront's Vercel project env settings.

| Var | Where | Status (2026-05-09) | What it does |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | VPS + local .env | ✅ set (rk_live) | All Stripe API calls + webhook signature material lookup |
| `STRIPE_PUBLISHABLE_KEY` | VPS + local .env | ✅ set (pk_live) | Future client-side Stripe.js — currently unused |
| `STRIPE_WEBHOOK_SECRET` | VPS | ✅ set | **Global** webhook signing secret — used by Intel API webhook + as fallback for any product-specific secret that's missing |
| `STRIPE_WEBHOOK_SECRET_CREDITSCORE` | VPS | ✅ set | CreditScore webhook signature verification |
| `STRIPE_WEBHOOK_SECRET_DIRECTORY` | VPS | ✅ set | Directory Listings webhook signature verification |
| `STRIPE_WEBHOOK_SECRET_WATCHTOWER` | VPS | ⚠️ **TO ADD** (`whsec_xyfUNOcT9nJJ1EQ55lxL2nY9mgBLE5Pt`, captured 2026-05-09) | Watchtower webhook signature verification. **Without this, Stripe's POST gets rejected as invalid signature** because the global secret is for the Intel API endpoint, not Watchtower. |
| `STRIPE_WEBHOOK_SECRET_UNIVERSITY` | VPS | ⛔ **TO ADD** (capture `whsec_…` when the `/api/university/webhook` endpoint is registered **on the Starwise account**) | Coherent Ones University webhook signature verification. The University webhook endpoint is registered on the **Starwise** account (where University bills), so this signing secret comes from Starwise. Falls back to the global secret if unset, but the global is for the CD Intel API endpoint — set this once the dedicated Starwise webhook exists. |
| `STRIPE_PRICE_*` (all bare price IDs) | VPS | ✅ all set | Direct price-ID resolution for non-Watchtower products. Must be hand-updated if a price is rotated. |
| `WATCHTOWER_STRIPE_PRICE_ID` | VPS | ⛔ deliberately unset | Watchtower resolves by lookup_key first — this env var is only the fallback. Leaving unset keeps the lookup_key path canonical. |
| `WATCHTOWER_ENABLED` | VPS | ⚠️ **`false` — must flip to `true` to launch** | Master gate on the Watchtower service + cron. When false, the cron skips and the checkout endpoint returns 503. |
| `WATCHTOWER_SUCCESS_URL` | VPS | (default in code) | Default success_url base for Stripe checkout. Falls back to `https://app.coherencedaddy.com/dashboard` (customer portal). |
| `WATCHTOWER_CANCEL_URL` | VPS | (default in code) | Default cancel_url base. Falls back to `https://coherencedaddy.com/watchtower-home`. |
| `WATCHTOWER_RETURN_URL` | VPS | (legacy) | Single-URL knob for both success + cancel — only used when SUCCESS_URL/CANCEL_URL are unset. Don't set this for new deployments. |
| `UNIVERSITY_STRIPE_SECRET_KEY` | VPS | ⛔ **TO ADD** (the Starwise Ventures rk_live/sk_live key) | The secret key for the **Starwise Ventures** Stripe account that University bills on. Used by the University price lookup + checkout (`routes/university-checkout.ts`) and the billing-portal session for University members (`routes/portal.ts`). **Falls back to `STRIPE_SECRET_KEY` when unset** so single-account local/dev/test still work — but in production this MUST be set to the Starwise key, or University checkout hits the wrong (CD) account and 500s (the `university_monthly` price lives only on Starwise). Set ONLY this; the global `STRIPE_SECRET_KEY` must stay the Coherence Daddy key for every other product. |
| `UNIVERSITY_STRIPE_PRICE_ID` | VPS | ⛔ deliberately unset | Coherent Ones University resolves by lookup_key (`university_monthly`) first — this env var is only the fallback (a bare Starwise price ID). Leave unset to keep the lookup_key path canonical. When set, it is resolved against the Starwise account (the lookup_key path already authenticates with `UNIVERSITY_STRIPE_SECRET_KEY`). |
| `UNIVERSITY_SUCCESS_URL` | VPS | (default in code) | Default success_url base for University checkout. Falls back to `https://app.coherencedaddy.com/university` (customer portal). |
| `UNIVERSITY_CANCEL_URL` | VPS | (default in code) | Default cancel_url base for University checkout. Falls back to `https://coherencedaddy.com/university` (storefront signup). |
| `WATCHTOWER_CALLBACK_KEY` | VPS + Vercel (storefront) | ✅ set on VPS | HMAC shared secret signing `/api/email/watchtower` envelopes (digest + answer-check report). **Must match on both ends or emails fail signature.** Verify the same value is in the Vercel storefront's env. |
| `WATCHTOWER_EMAIL_CALLBACK_URL` | VPS | ✅ set | Storefront receiver for HMAC-signed email envelopes (default falls back to the freetools.* alias which 301-redirects to coherencedaddy.com). |
| `WATCHTOWER_CHECKOUT_PUBLIC_URL` | VPS | (default in code) | URL embedded in 429 rate-limit responses for `/api/public/answer-check/run`. Falls back to `coherencedaddy.com/watchtower-home#pricing`. |

## Standard operations

### Add a new product (one-shot)

1. Decide on a stable `lookup_key` (e.g. `<product>_monthly`, `<product>_annual`). **Always use a lookup_key for new products** — see fragility note above.
2. Run from local repo root:
   ```bash
   STRIPE_SECRET_KEY=$(grep -E "^STRIPE_SECRET_KEY=" \
     /Users/exe/Downloads/Claude/team-dashboard/.env \
     | head -1 | cut -d= -f2-) \
     npx tsx scripts/setup-<product>-stripe-product.ts
   ```
   Pattern: copy `scripts/setup-watchtower-stripe-product.ts` and edit the constants at the top. The script is idempotent — re-running on an existing lookup_key is a no-op.
3. Append a row to the product table above + add a section to [stripe-products.md](stripe-products.md).
4. The Webhook step is separate (next section).

### Add a webhook for a new product

1. Pick the events you actually handle (look at the per-product handler — most use `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`).
2. Create the endpoint via API:
   ```bash
   STRIPE_SECRET_KEY=$(grep -E "^STRIPE_SECRET_KEY=" \
     /Users/exe/Downloads/Claude/team-dashboard/.env \
     | head -1 | cut -d= -f2-) && \
   curl -sS -u "$STRIPE_SECRET_KEY:" "https://api.stripe.com/v1/webhook_endpoints" \
     -d "url=https://api.coherencedaddy.com/api/<product>/webhook" \
     -d "description=<Product> (team-dashboard) — <one-liner>, $(date +%F)" \
     -d "enabled_events[]=checkout.session.completed" \
     -d "enabled_events[]=customer.subscription.updated" \
     -d "enabled_events[]=customer.subscription.deleted" \
     -d "metadata[product]=<product>"
   ```
3. **Copy `secret` from the response** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET_<PRODUCT>` in `/opt/team-dashboard/.env.production` and restart the container.
4. Append the endpoint to the webhook table above.

### Rotate the global Stripe secret key

Quarterly hygiene — not a regular operation. Procedure:
1. Generate a new restricted key in Stripe Dashboard → Developers → API keys with the same scope as the current `rk_live_…` key.
2. Update `STRIPE_SECRET_KEY` in:
   - `team-dashboard/.env` (local)
   - `/opt/team-dashboard/.env.production` (VPS4)
3. `docker compose restart server`
4. Smoke-test by hitting any checkout endpoint and observing a `200`.
5. Revoke the old key in Stripe Dashboard.

## Gotchas (lessons from past pain)

### 1. The `stripe` CLI is authed to the wrong account
`stripe products create --live` from the locally-installed CLI targets `acct_1QF1QeQwTOfgszhy`. **All CD products live in `acct_1TJQywQvkbvTR7Og`.** Always use the `.env` `STRIPE_SECRET_KEY` directly via `curl` or the helper scripts — never the bare CLI for product/price/webhook mutations. (Confirmed 2026-05-09 — first Watchtower product create attempt succeeded only after re-running with the .env key.)

### 2. Per-product webhook secrets > global
Every product's webhook code does:
```js
const secret = process.env.STRIPE_WEBHOOK_SECRET_<PRODUCT>
            || process.env.STRIPE_WEBHOOK_SECRET;
```
**The fallback to the global secret is a footgun.** If you create a webhook in Stripe and forget to set the per-product env var, signature verification will silently 400 every event because the global secret is for a *different* endpoint. Always set the per-product secret.

### 3. Lookup keys are unique per account but not searchable until indexed
After creating a price with a new lookup_key, `prices/search?query=lookup_key:'<key>'` may return empty for a few seconds while Stripe's search index catches up. The `setup-watchtower-stripe-product.ts` script is idempotent so re-running is safe, but if you script multiple product creates, do them sequentially and don't rely on search to verify until a few seconds later.

### 4. The CALLBACK_KEY must match on both ends
`WATCHTOWER_CALLBACK_KEY` is set on the VPS (signs outgoing envelopes) AND on the Vercel storefront (verifies incoming envelopes). If they drift, every Watchtower email fails 400. Same for `CREDITSCORE_CALLBACK_KEY`.

## Open follow-ups

- [ ] Adopt `lookup_key` resolution for CreditScore / Directory / Partners / Intel API. Today they hard-code price IDs in env vars; rotating a price needs a manual VPS env edit + restart. Pattern: copy what watchtower-checkout.ts:60-86 does.
- [ ] Bundle product is referenced in the codebase (`bundle-entitlements.ts`, `bundle-subscriptions` table) but has no Stripe Product/Price registered. Either create one (if Bundles is being sold) or remove the dead code.
- [ ] Re-point the local `stripe` CLI to `acct_1TJQywQvkbvTR7Og` so future ops don't need to manually pass the .env key. `stripe login --interactive` then pick the right account.
- [ ] Quarterly key-rotation reminder — last rotation was 2026-04-23 for the CreditScore webhook. Next due ~2026-07-23.

## Changelog

- **2026-05-09** — Live Watchtower product/price/webhook all created on
  `acct_1TJQywQvkbvTR7Og`. Captured webhook signing secret. New env var
  `STRIPE_WEBHOOK_SECRET_WATCHTOWER` to be set on VPS4 in this same deploy.
  Doc structure split: this runbook (shared ops) vs.
  [stripe-products.md](stripe-products.md) (per-product specs).
