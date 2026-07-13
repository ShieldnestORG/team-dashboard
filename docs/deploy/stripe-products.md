# Stripe Products & Prices

> Append-only registry of Stripe products + price IDs that team-dashboard
> is the source of truth for. Per [docs/OWNERSHIP.md](../OWNERSHIP.md),
> all checkout-session creation + webhook handling lives in this repo;
> the storefront proxies `/checkout` and `/webhook` paths.

## Conventions

- One Stripe **Product** per shippable thing.
- One or more **Prices** per Product (one-time or recurring).
- Use `lookup_key` on each Price so the backend can resolve by stable key
  rather than hard-coded `price_xxx` IDs that change between accounts.
- Test-mode and Live-mode have different IDs. Set the test-mode ID in
  `.env.local` and the live-mode ID in production env vars.

## Registry

| Product | Plan / Price | Stripe price ID | Recurring | Owner | Code references |
|---|---|---|---|---|---|
| llms.txt generator | $19 one-time | _pending — see lookup_key_ | one-time | llms-txt-generator | `server/src/services/llms-txt-generator.ts` |
| Watchtower | $49/mo | `price_1TseofQvkbvTR7OgrYdGUBNL` (lookup_key `watchtower_monthly`, prod `prod_UUNfgdeWldCIQS`; supersedes archived $29 `price_1TVOu6QvkbvTR7Og3xrx0GsG`) | monthly | watchtower | `server/src/services/watchtower-monitor.ts`, `server/src/services/watchtower-cron.ts` |
| Coherent Ones University | $50/mo founding → $79/mo standard past the Founding-100 cap ($500/yr annual) | lookup_keys `university_monthly` ✅ / `university_annual` ✅ / `university_monthly_standard` ⛔ create pre-cap (Starwise acct) | monthly/annual | university | `server/src/services/university-stripe-handler.ts`, `server/src/routes/university-checkout.ts`, `docs/university-founding-pricing.md` |

## llms.txt generator — $19 one-time

- **Stripe Product name:** `llms.txt generator`
- **Description:** "One-shot generation of llms.txt + llms-full.txt + agents.json files for your domain. Crawls your sitemap, summarizes each page, returns three files. Free with any $49+/mo bundle."
- **Statement descriptor:** `CD LLMS-TXT`
- **Tax behavior:** Inclusive
- **Prices:**
  - `llms_txt_generator_one_time` — **$19.00 USD one-time**.
- **Webhook event of interest:** `checkout.session.completed` with
  `metadata.product = "llms_txt_generator"` and `metadata.domain = "<customer-domain>"`.
- **Backend handler:**
  `handleLlmsTxtCheckout(db, session)` in `server/src/services/llms-txt-generator.ts`.
  Inserts a `llms_txt_jobs` row and kicks off generation.
- **Wire-up status (2026-05-09):** Webhook handler **exists** but is **not
  yet routed** in the consolidated Stripe webhook router. Once the shared
  dispatcher lands, add a case for `metadata.product = "llms_txt_generator"`
  that calls `handleLlmsTxtCheckout`.
- **Until then:** Anonymous public-form requests use
  `POST /api/llms-txt/generate` directly (no Stripe in the loop).

## Watchtower — $49/mo

Brand-mention monitor. See [docs/products/watchtower.md](../products/watchtower.md).

- **Stripe product name:** `Watchtower`
- **Price:** $49 USD recurring monthly
- **Price lookup_key:** `watchtower_monthly` (preferred resolution path)
- **Price ID env var (fallback):** `WATCHTOWER_STRIPE_PRICE_ID`
- **Status (2026-07-13):** ✅ **Price change $29 → $49** (owner decision).
  New Price `price_1TseofQvkbvTR7OgrYdGUBNL` ($49.00/mo USD) created on
  `prod_UUNfgdeWldCIQS` with `transfer_lookup_key=true`; the original $29
  price `price_1TVOu6QvkbvTR7Og3xrx0GsG` is archived (active=false,
  lookup_key removed). Zero subscriptions existed on the old price at flip
  time — no grandfathering needed. Verified end-to-end same day: prod
  `POST /api/watchtower/checkout` session `amount_total=4900`.
- **Status (2026-05-09):** ✅ Live Product + Price created on Coherence Daddy
  account `acct_1TJQywQvkbvTR7Og`:
  - Product: `prod_UUNfgdeWldCIQS`
  - Price: `price_1TVOu6QvkbvTR7Og3xrx0GsG` (lookup_key `watchtower_monthly`)
  - $29.00/mo USD recurring (superseded 2026-07-13, see above)
  - Created via `scripts/setup-watchtower-stripe-product.ts` using
    `STRIPE_SECRET_KEY` from local `.env` (rk_live key for the CD
    account; `acct_1QF1Qe…` is a separate account that the Stripe CLI
    is authed to — do NOT confuse). Backend resolves by lookup_key, so
    `WATCHTOWER_STRIPE_PRICE_ID` is unset in prod (intentionally — let
    the lookup_key path stay the source of truth).
- **Post-checkout flow:** success → `https://app.coherencedaddy.com/dashboard?status=success&session_id=…&product=watchtower`
  (customer portal — surfaces the new entitlement and the cross-sell
  shelf with CreditScore Growth / 100 Agents / Wikidata-Crunchbase entity
  service). Cancel → `https://coherencedaddy.com/watchtower-home?status=cancelled`
  (storefront signup form — preserves their inputs). Override either via
  `WATCHTOWER_SUCCESS_URL` / `WATCHTOWER_CANCEL_URL`.
- **Webhook secret env var:** `STRIPE_WEBHOOK_SECRET_WATCHTOWER`
  (falls back to global `STRIPE_WEBHOOK_SECRET` if unset)
- **Webhook endpoint:** `POST /api/watchtower/webhook`
- **Checkout endpoint:** `POST /api/watchtower/checkout`
  Body: `{ brandName: string, domain: string, prompts: string[] (1-25), email: string, returnUrl?: string }`
- **Customer-portal allowed actions (planned, follow-up):** cancel, pause (mapped to `watchtower_subscriptions.status='paused'`)
- **Webhook events handled:**
  - `checkout.session.completed` → INSERT (or UPDATE on replay) `watchtower_subscriptions`
    + chains `linkStripeCustomerToAccount` for portal-auth
  - `customer.subscription.updated` → mirror `status`:
    `active|trialing → active`, `past_due|unpaid → past_due`,
    `paused → paused`, `canceled|incomplete_expired → cancelled`
  - `customer.subscription.deleted` → set `status='cancelled'` (row preserved for history)
- **Backend handlers:** `handleWatchtowerCheckout`,
  `handleWatchtowerSubscriptionUpdated`, `handleWatchtowerSubscriptionDeleted`
  in `server/src/services/watchtower-stripe-handler.ts`. All idempotent.
- **Fulfillment:** monthly bill triggers no immediate fulfillment;
  weekly cron `watchtower:weekly-runs` (Mon 09:00 UTC) does the work.

## Coherent Ones University — $50/mo

Monthly membership in the Coherence Daddy ecosystem. A University member is its
**own member class** (`university_members`), not just an access flag — the
member entity is real, while login reuses the shared magic-link
`customer_accounts` identity and the existing Stripe pipeline.

- **Stripe product name:** `Coherent Ones University`
- **Account:** University bills on the **Starwise** Stripe account
  (`UNIVERSITY_STRIPE_SECRET_KEY`), NOT the shared CD account — owner decision
  2026-06-18.
- **Prices (Founding-100 two-tier — see docs/university-founding-pricing.md):**

  | Tier | Amount | lookup_key | Env fallback | Status |
  |---|---|---|---|---|
  | Founding monthly | $50/mo (`5000`) | `university_monthly` | `UNIVERSITY_STRIPE_PRICE_ID` | ✅ live (Starwise, 2026-06-18) |
  | Founding annual | $500/yr (`50000`) | `university_annual` | `UNIVERSITY_ANNUAL_PRICE_ID` | ✅ live (Wave-2) |
  | Standard monthly | $79/mo (`7900`) | `university_monthly_standard` | `UNIVERSITY_STRIPE_STANDARD_PRICE_ID` | ✅ live (`price_1TrArqAf8PjDIzDYr4Hyzbi5`, created 2026-07-09) |
  | Standard annual | $790/yr (`79000`) — "two months free for our yearly dedicated members" | `university_annual_standard` | `UNIVERSITY_ANNUAL_STANDARD_PRICE_ID` | ✅ live (`price_1TrLvUAf8PjDIzDYhXFQbKdl`, created 2026-07-09; a mispriced $869 predecessor is archived, lookup_key transferred) |

  The first `UNIVERSITY_FOUNDING_CAP` (default 100) members get the founding
  tier; after that checkout switches to the standard tier and **fails closed
  (503)** if the standard price doesn't resolve — it never sells the founding
  rate past the cap. **Never edit or archive the founding prices** — existing
  subscriptions stay bound to the Price they were created on, which is the
  entire grandfather guarantee.
- **Post-checkout flow:** success → `https://app.coherencedaddy.com/university?status=success&session_id=…&product=university`
  (customer portal — surfaces the new membership). Cancel →
  `https://coherencedaddy.com/university?status=cancelled` (storefront signup).
  Override either via `UNIVERSITY_SUCCESS_URL` / `UNIVERSITY_CANCEL_URL`.
- **Webhook secret env var:** `STRIPE_WEBHOOK_SECRET_UNIVERSITY`
  (falls back to global `STRIPE_WEBHOOK_SECRET` if unset)
- **Webhook endpoint:** `POST /api/university/webhook`
- **Checkout endpoint:** `POST /api/university/checkout`
  Body: `{ email: string, displayName?: string, returnUrl?: string }`
- **Webhook events handled:**
  - `checkout.session.completed` → chains `linkStripeCustomerToAccount`,
    upserts `university_subscriptions` (idempotent on `stripe_subscription_id`)
    + upserts `university_members` (status active, joined_at set)
  - `customer.subscription.updated` → mirror `status` onto BOTH rows:
    `active|trialing → active`, `past_due|unpaid → past_due`,
    `canceled|incomplete_expired → cancelled`. University has **no paused
    member state**, so Stripe `paused` is a deliberate no-op.
  - `customer.subscription.deleted` → set `status='cancelled'` on both rows
    (rows preserved for history)
- **Backend handlers:** `handleUniversityCheckout`,
  `handleUniversitySubscriptionUpdated`, `handleUniversitySubscriptionDeleted`
  in `server/src/services/university-stripe-handler.ts`. All idempotent.
- **Portal entitlement:** detected in `getAccountWithEntitlements`
  (`server/src/services/customer-portal.ts`) by the newest
  `university_members` row matching the account email (or account_id) with
  status IN ('active','past_due').

## Adding a new product

1. Create the product + price in the Stripe dashboard (live mode).
2. Append a row to the registry table above.
3. Add a section with: env var name, allowed portal actions, webhook
   events handled, fulfillment behavior.
4. Code: add the price ID env var to `docs/deploy/env-vars.md`.

## Notes

- When creating prices in the Stripe dashboard, set the `lookup_key` field
  to the snake_case key shown above. The backend resolves via
  `stripe.prices.list({ lookup_keys: [key], expand: ["data.product"] })`.
- After creating in the dashboard, copy the test-mode + live-mode IDs into
  this file so future engineers don't have to log into Stripe to find them.
